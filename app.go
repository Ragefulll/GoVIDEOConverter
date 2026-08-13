package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	mu         sync.Mutex
	files      map[string]*VideoItem
	cancel     context.CancelFunc
	cancels    map[string]context.CancelFunc
	ffmpegMu   sync.Mutex
	installing bool
	updateMu   sync.Mutex
	update     UpdateStatus
	checking   bool
}

type Settings struct {
	Resolution           string                       `json:"resolution"`
	Resolutions          []string                     `json:"resolutions"`
	Codec                string                       `json:"codec"`
	Encoder              string                       `json:"encoder"`
	Container            string                       `json:"container"`
	BitDepth             int                          `json:"bitDepth"`
	CRF                  int                          `json:"crf"`
	BitrateKbps          int                          `json:"bitrateKbps"`
	MaxrateKbps          int                          `json:"maxrateKbps"`
	BufsizeKbps          int                          `json:"bufsizeKbps"`
	BitrateByResolution  map[string]ResolutionBitrate `json:"bitrateByResolution"`
	CompressionMode      string                       `json:"compressionMode"`
	Preset               string                       `json:"preset"`
	Throttle             int                          `json:"throttle"`
	RemoveAudio          bool                         `json:"removeAudio"`
	Overwrite            bool                         `json:"overwrite"`
	FirstScreen          bool                         `json:"firstScreen"`
	LastScreen           bool                         `json:"lastScreen"`
	AllKeyframes         bool                         `json:"allKeyframes"`
	ValidateDecode       bool                         `json:"validateDecode"`
	OutputPrefix         string                       `json:"outputPrefix"`
	OutputDirectory      string                       `json:"outputDirectory"`
	FFmpegPath           string                       `json:"ffmpegPath"`
	PreserveAspectLetter bool                         `json:"preserveAspectLetter"`
}

type ResolutionBitrate struct {
	BitrateKbps int `json:"bitrateKbps"`
	MaxrateKbps int `json:"maxrateKbps"`
	BufsizeKbps int `json:"bufsizeKbps"`
}

type VideoItem struct {
	ID       string        `json:"id"`
	Path     string        `json:"path"`
	Name     string        `json:"name"`
	Size     int64         `json:"size"`
	Status   string        `json:"status"`
	Progress float64       `json:"progress"`
	Output   string        `json:"output"`
	Error    string        `json:"error"`
	Meta     VideoMetadata `json:"meta"`
}

type VideoMetadata struct {
	Duration     float64 `json:"duration"`
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	Codec        string  `json:"codec"`
	PixelFormat  string  `json:"pixelFormat"`
	Bitrate      int64   `json:"bitrate"`
	FPS          string  `json:"fps"`
	AudioCodec   string  `json:"audioCodec"`
	Format       string  `json:"format"`
	Rotation     int     `json:"rotation"`
	CreationTime string  `json:"creationTime"`
}

type ProgressEvent struct {
	ID       string  `json:"id"`
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Frame    int     `json:"frame"`
	FPS      float64 `json:"fps"`
	Speed    string  `json:"speed"`
	Output   string  `json:"output"`
	Error    string  `json:"error"`
}

type AddProgressEvent struct {
	Phase    string  `json:"phase"`
	Current  int     `json:"current"`
	Total    int     `json:"total"`
	Progress float64 `json:"progress"`
	FileName string  `json:"fileName"`
	Done     bool    `json:"done"`
}

type ffprobeOutput struct {
	Streams []struct {
		CodecType    string            `json:"codec_type"`
		CodecName    string            `json:"codec_name"`
		Width        int               `json:"width"`
		Height       int               `json:"height"`
		PixFmt       string            `json:"pix_fmt"`
		RFrameRate   string            `json:"r_frame_rate"`
		Tags         map[string]string `json:"tags"`
		SideDataList []struct {
			Rotation int `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		Bitrate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
}

func NewApp() *App {
	return &App{files: map[string]*VideoItem{}, cancels: map[string]context.CancelFunc{}}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) DefaultSettings() Settings {
	s := Settings{
		Resolution: "1080", Resolutions: []string{"1080"}, Codec: "h264", Encoder: "auto", Container: "mp4",
		BitDepth: 8, CRF: 23, BitrateKbps: 5000, MaxrateKbps: 6000, BufsizeKbps: 12000,
		CompressionMode: "bitrate", Preset: "medium", Throttle: 4, RemoveAudio: true,
		OutputPrefix: "_", PreserveAspectLetter: true, ValidateDecode: true,
		BitrateByResolution: map[string]ResolutionBitrate{
			"360":  {BitrateKbps: 800, MaxrateKbps: 1000, BufsizeKbps: 2000},
			"720":  {BitrateKbps: 2500, MaxrateKbps: 3000, BufsizeKbps: 6000},
			"1080": {BitrateKbps: 5000, MaxrateKbps: 6000, BufsizeKbps: 12000},
			"2k":   {BitrateKbps: 12000, MaxrateKbps: 14000, BufsizeKbps: 28000},
			"4k":   {BitrateKbps: 25000, MaxrateKbps: 30000, BufsizeKbps: 60000},
		},
	}
	if stored := storedFFmpegPath(); stored != "" {
		s.FFmpegPath = stored
	}
	return s
}

func (a *App) AddPaths(paths []string) ([]VideoItem, error) {
	_, ffprobe, err := resolveTools("")
	if err != nil {
		return nil, errors.New("ffprobe не найден. Установите FFmpeg или укажите его путь.")
	}
	a.emitAddProgress("Сканирование", 0, 0, "", false)
	files := expandPaths(paths)
	var out []VideoItem
	total := len(files)
	for index, p := range files {
		a.emitAddProgress("Анализ метаданных", index+1, total, filepath.Base(p), false)
		meta, err := probeVideo(ffprobe, p)
		if err != nil {
			continue
		}
		info, _ := os.Stat(p)
		id := stableID(p)
		a.mu.Lock()
		if existing, ok := a.files[id]; ok {
			out = append(out, *existing)
			a.mu.Unlock()
			continue
		}
		item := &VideoItem{ID: id, Path: p, Name: filepath.Base(p), Status: "Ожидает", Size: info.Size(), Meta: meta}
		a.files[item.ID] = item
		a.mu.Unlock()
		out = append(out, *item)
	}
	a.emitAddProgress("Готово", total, total, "", true)
	return out, nil
}

func (a *App) emitAddProgress(phase string, current, total int, fileName string, done bool) {
	progress := 0.0
	if total > 0 {
		progress = math.Min(100, float64(current)/float64(total)*100)
	}
	if done {
		progress = 100
	}
	runtime.EventsEmit(a.ctx, "queue-add-progress", AddProgressEvent{
		Phase: phase, Current: current, Total: total, Progress: progress, FileName: fileName, Done: done,
	})
}

func (a *App) ListFiles() []VideoItem {
	a.mu.Lock()
	defer a.mu.Unlock()
	items := make([]VideoItem, 0, len(a.files))
	for _, item := range a.files {
		items = append(items, *item)
	}
	return items
}

func (a *App) ClearFiles() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, cancel := range a.cancels {
		cancel()
	}
	a.files = map[string]*VideoItem{}
	a.cancels = map[string]context.CancelFunc{}
}

func (a *App) RemoveFile(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.cancels[id]; ok {
		cancel()
		delete(a.cancels, id)
	}
	delete(a.files, id)
}

func (a *App) ExportPresets(content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Экспорт пресетов",
		DefaultFilename: "gvc-presets.json",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON-файл (*.json)", Pattern: "*.json"},
			{DisplayName: "Все файлы (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if filepath.Ext(path) == "" {
		path += ".json"
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ImportPresets() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Импорт пресетов",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON-файл (*.json)", Pattern: "*.json"},
			{DisplayName: "Все файлы (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (a *App) StartProcessing(settings Settings) error {
	a.mu.Lock()
	if a.cancel != nil {
		a.mu.Unlock()
		return errors.New("обработка уже запущена")
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	items := make([]*VideoItem, 0, len(a.files))
	for _, item := range a.files {
		item.Status = "В очереди"
		item.Progress = 0
		item.Error = ""
		items = append(items, item)
	}
	a.mu.Unlock()

	go func() {
		defer func() {
			a.mu.Lock()
			a.cancel = nil
			a.mu.Unlock()
			runtime.EventsEmit(a.ctx, "processing-finished")
		}()
		a.processQueue(ctx, items, normalizeSettings(settings))
	}()
	return nil
}

func (a *App) StartFile(id string, settings Settings) error {
	a.mu.Lock()
	item, ok := a.files[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("файл не найден в очереди")
	}
	if _, running := a.cancels[id]; running {
		a.mu.Unlock()
		return errors.New("этот файл уже обрабатывается")
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancels[id] = cancel
	item.Status = "В очереди"
	item.Progress = 0
	item.Error = ""
	a.mu.Unlock()

	go func() {
		defer a.removeCancel(id)
		a.processOne(ctx, item, normalizeSettings(settings))
		runtime.EventsEmit(a.ctx, "processing-finished")
	}()
	return nil
}

func (a *App) CancelProcessing() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
	}
	for _, cancel := range a.cancels {
		cancel()
	}
}

func (a *App) CancelFile(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.cancels[id]; ok {
		cancel()
	}
}

func (a *App) processQueue(ctx context.Context, items []*VideoItem, s Settings) {
	throttle := s.Throttle
	if throttle < 1 {
		throttle = 1
	}
	jobs := make(chan *VideoItem)
	var wg sync.WaitGroup
	for i := 0; i < throttle; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				itemCtx, cancel := context.WithCancel(ctx)
				a.setCancel(item.ID, cancel)
				a.processOne(itemCtx, item, s)
				a.removeCancel(item.ID)
			}
		}()
	}
	for _, item := range items {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return
		case jobs <- item:
		}
	}
	close(jobs)
	wg.Wait()
}

func (a *App) setCancel(id string, cancel context.CancelFunc) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cancels[id] = cancel
}

func (a *App) removeCancel(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.cancels, id)
}

func (a *App) processOne(ctx context.Context, item *VideoItem, s Settings) {
	ffmpeg, ffprobe, err := resolveTools(s.FFmpegPath)
	if err != nil {
		a.emit(item, "Ошибка", 0, "", err.Error(), 0, 0, "")
		return
	}
	s = resolveAutoCodec(s, item)
	resolutions := resolutionList(s)
	total := len(resolutions)
	for i, res := range resolutions {
		sub := s
		sub.Resolution = res
		sub.Resolutions = resolutions
		output := outputPathFor(item.Path, sub, res, total)
		if !a.processOneOutput(ctx, item, sub, output, i+1, total, ffmpeg, ffprobe) {
			return
		}
	}
}

func (a *App) processOneOutput(ctx context.Context, item *VideoItem, s Settings, output string, idx, total int, ffmpeg, ffprobe string) bool {
	item.Output = output
	if !s.Overwrite {
		if info, err := os.Stat(output); err == nil && info.Size() > 0 {
			a.emit(item, "Пропущено", 100, output, "", 0, 0, "")
			return true
		}
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		a.emit(item, "Ошибка", 0, output, err.Error(), 0, 0, "")
		return false
	}
	if idx == 1 && s.FirstScreen {
		_ = makeFirstScreen(ctx, ffmpeg, item, s, output)
	}
	if idx == 1 && s.LastScreen {
		_ = makeLastScreen(ctx, ffmpeg, item, s, output)
	}
	a.emit(item, "Обработка", 1, output, "", 0, 0, "")

	tmp := strings.TrimSuffix(output, filepath.Ext(output)) + ".partial." + strconv.FormatInt(time.Now().UnixNano(), 36) + filepath.Ext(output)
	args := ffmpegArgs(item, tmp, s)
	cmd := newCommandContext(ctx, ffmpeg, args...)
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		a.emit(item, "Ошибка", 0, output, err.Error(), 0, 0, "")
		return false
	}
	scanner := bufio.NewScanner(stdout)
	progress := map[string]string{}
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		progress[parts[0]] = parts[1]
		if parts[0] == "progress" {
			pct := progressPercent(progress["out_time_ms"], item.Meta.Duration)
			frame, _ := strconv.Atoi(progress["frame"])
			fps, _ := strconv.ParseFloat(progress["fps"], 64)
			a.emit(item, "Обработка", pct, output, "", frame, fps, progress["speed"])
		}
	}
	err := cmd.Wait()
	if ctx.Err() != nil {
		_ = os.Remove(tmp)
		a.emit(item, "Отменено", item.Progress, output, "", 0, 0, "")
		return false
	}
	if err != nil {
		_ = os.Remove(tmp)
		a.emit(item, "Ошибка", item.Progress, output, err.Error(), 0, 0, "")
		return false
	}
	if s.ValidateDecode {
		if err := validateOutput(ctx, ffmpeg, tmp); err != nil {
			_ = os.Remove(tmp)
			a.emit(item, "Ошибка", item.Progress, output, "валидация декодирования: "+err.Error(), 0, 0, "")
			return false
		}
	}
	_ = os.Remove(output)
	if err := os.Rename(tmp, output); err != nil {
		a.emit(item, "Ошибка", item.Progress, output, err.Error(), 0, 0, "")
		return false
	}
	_, _ = probeVideo(ffprobe, output)
	a.emit(item, "Готово", 100, output, "", 0, 0, "")
	return true
}

func (a *App) emit(item *VideoItem, status string, pct float64, output, errText string, frame int, fps float64, speed string) {
	a.mu.Lock()
	item.Status, item.Progress, item.Output, item.Error = status, math.Max(0, math.Min(100, pct)), output, errText
	id := item.ID
	a.mu.Unlock()
	runtime.EventsEmit(a.ctx, "file-progress", ProgressEvent{ID: id, Status: status, Progress: pct, Output: output, Error: errText, Frame: frame, FPS: fps, Speed: speed})
}

func probeVideo(ffprobe, path string) (VideoMetadata, error) {
	cmd := newCommand(ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path)
	raw, err := cmd.Output()
	if err != nil {
		return VideoMetadata{}, err
	}
	var data ffprobeOutput
	if err := json.Unmarshal(raw, &data); err != nil {
		return VideoMetadata{}, err
	}
	var meta VideoMetadata
	meta.Format = data.Format.FormatName
	meta.Duration, _ = strconv.ParseFloat(data.Format.Duration, 64)
	meta.Bitrate, _ = strconv.ParseInt(data.Format.Bitrate, 10, 64)
	meta.CreationTime = data.Format.Tags["creation_time"]
	for _, stream := range data.Streams {
		if stream.CodecType == "video" && meta.Codec == "" {
			meta.Codec, meta.Width, meta.Height, meta.PixelFormat, meta.FPS = stream.CodecName, stream.Width, stream.Height, stream.PixFmt, stream.RFrameRate
			if len(stream.SideDataList) > 0 {
				meta.Rotation = stream.SideDataList[0].Rotation
			}
		}
		if stream.CodecType == "audio" && meta.AudioCodec == "" {
			meta.AudioCodec = stream.CodecName
		}
	}
	if meta.Codec == "" {
		return meta, errors.New("видео-поток не найден")
	}
	return meta, nil
}

func ffmpegArgs(item *VideoItem, output string, s Settings) []string {
	w, h := targetSize(item, s.Resolution)
	filter := fmt.Sprintf("scale=w=%d:h=%d:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=%s", w, h, w, h, pixelFormat(s))
	args := []string{"-hide_banner", "-nostdin", "-y", "-i", item.Path, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0", "-vf", filter, "-fps_mode", "passthrough", "-c:v", encoderName(s)}
	switch s.Codec {
	case "prores":
		args = append(args, "-profile:v", "3")
	case "ffv1":
		args = append(args, "-level", "3")
	case "av1":
		if s.CompressionMode == "crf" {
			args = append(args, "-crf", strconv.Itoa(s.CRF), "-b:v", "0")
		} else {
			br, mr, bs := bitrateFor(s, s.Resolution)
			args = append(args, "-b:v", kb(br), "-maxrate", kb(mr), "-bufsize", kb(bs))
		}
	default:
		if s.CompressionMode == "crf" {
			args = append(args, "-crf", strconv.Itoa(s.CRF))
		} else {
			br, mr, bs := bitrateFor(s, s.Resolution)
			args = append(args, "-b:v", kb(br), "-maxrate", kb(mr), "-bufsize", kb(bs))
		}
	}
	args = append(args, encoderPresetArgs(encoderName(s), s.Preset)...)
	if s.AllKeyframes {
		args = append(args, "-g", "1")
	}
	if s.RemoveAudio {
		args = append(args, "-an")
	} else {
		args = append(args, "-c:a", audioEncoder(s), "-b:a", "192k")
	}
	if containerName(s) == "mp4" || containerName(s) == "mov" {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, "-progress", "pipe:1", "-nostats", "-f", muxerName(s), output)
	return args
}

func audioEncoder(s Settings) string {
	if containerName(s) == "webm" {
		return "libopus"
	}
	if s.Codec == "prores" && containerName(s) == "mov" {
		return "pcm_s24le"
	}
	return "aac"
}

func makeFirstScreen(ctx context.Context, ffmpeg string, item *VideoItem, s Settings, outputVideo string) error {
	w, h := targetSize(item, s.Resolution)
	out := strings.TrimSuffix(outputVideo, filepath.Ext(outputVideo)) + ".jpg"
	filter := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black", w, h, w, h)
	return newCommandContext(ctx, ffmpeg, "-hide_banner", "-v", "error", "-y", "-i", item.Path, "-frames:v", "1", "-vf", filter, "-q:v", "2", out).Run()
}

func makeLastScreen(ctx context.Context, ffmpeg string, item *VideoItem, s Settings, outputVideo string) error {
	w, h := targetSize(item, s.Resolution)
	out := strings.TrimSuffix(outputVideo, filepath.Ext(outputVideo)) + "_last.jpg"
	filter := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black", w, h, w, h)
	return newCommandContext(ctx, ffmpeg, "-hide_banner", "-v", "error", "-y", "-sseof", "-0.1", "-i", item.Path, "-frames:v", "1", "-vf", filter, "-q:v", "2", out).Run()
}

func validateOutput(ctx context.Context, ffmpeg, path string) error {
	return newCommandContext(ctx, ffmpeg, "-hide_banner", "-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-f", "null", "NUL").Run()
}

func expandPaths(paths []string) []string {
	exts := map[string]bool{".mp4": true, ".mkv": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true, ".webm": true, ".m4v": true, ".mpg": true, ".mpeg": true, ".m2ts": true, ".mts": true, ".ts": true, ".3gp": true, ".ogv": true, ".mxf": true, ".vob": true}
	var files []string
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			if exts[strings.ToLower(filepath.Ext(p))] {
				files = append(files, p)
			}
			continue
		}
		_ = filepath.WalkDir(p, func(path string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && exts[strings.ToLower(filepath.Ext(path))] && !strings.HasPrefix(filepath.Base(path), "_") {
				files = append(files, path)
			}
			return nil
		})
	}
	return files
}

func normalizeSettings(s Settings) Settings {
	if s.OutputPrefix == "" {
		s.OutputPrefix = "_"
	}
	if s.Codec == "" {
		s.Codec = "h264"
	}
	if s.Container == "" {
		s.Container = "auto"
	}
	if s.Encoder == "" {
		s.Encoder = "auto"
	}
	if s.Preset == "" {
		s.Preset = "medium"
	}
	if s.CRF == 0 {
		s.CRF = 23
	}
	if len(s.Resolutions) == 0 && s.Resolution != "" {
		s.Resolutions = []string{s.Resolution}
	}
	if len(s.Resolutions) == 0 {
		s.Resolutions = []string{"1080"}
	}
	return s
}

func resolveAutoCodec(s Settings, item *VideoItem) Settings {
	if s.Codec == "" || s.Codec == "auto" {
		s.Codec = codecFromSource(item.Meta.Codec)
	}
	if s.Container == "" || s.Container == "auto" {
		s.Container = defaultContainer(s.Codec)
	}
	return s
}

func codecFromSource(src string) string {
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "h264", "avc1":
		return "h264"
	case "hevc", "h265", "hev1":
		return "hevc"
	case "vp9":
		return "vp9"
	case "av1":
		return "av1"
	case "prores", "prores_ks":
		return "prores"
	case "ffv1":
		return "ffv1"
	default:
		return "h264"
	}
}

func resolutionList(s Settings) []string {
	var list []string
	for _, r := range s.Resolutions {
		r = strings.ToLower(strings.TrimSpace(r))
		if r != "" {
			list = append(list, r)
		}
	}
	if len(list) == 0 && s.Resolution != "" {
		list = append(list, strings.ToLower(strings.TrimSpace(s.Resolution)))
	}
	if len(list) == 0 {
		list = []string{"1080"}
	}
	return list
}

func targetSize(item *VideoItem, resolution string) (int, int) {
	sizes := map[string][2]int{"360": {640, 360}, "720": {1280, 720}, "1080": {1920, 1080}, "2k": {2560, 1440}, "4k": {3840, 2160}}
	size := sizes[resolution]
	if size == [2]int{} {
		size = sizes["1080"]
	}
	if item.Meta.Height > item.Meta.Width {
		return size[1], size[0]
	}
	return size[0], size[1]
}

func encoderName(s Settings) string {
	if s.Encoder != "" && s.Encoder != "auto" {
		return s.Encoder
	}
	return map[string]string{"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1", "vp9": "libvpx-vp9", "prores": "prores_ks", "ffv1": "ffv1"}[s.Codec]
}

func encoderPresetArgs(enc, preset string) []string {
	if strings.Contains(enc, "nvenc") {
		return []string{"-preset", "p5", "-tune", "hq"}
	}
	if strings.Contains(enc, "libsvtav1") {
		return []string{"-preset", "6"}
	}
	if preset != "" && strings.Contains(enc, "libx26") {
		return []string{"-preset", preset}
	}
	return nil
}

func pixelFormat(s Settings) string {
	if s.BitDepth == 10 {
		return "yuv420p10le"
	}
	return "yuv420p"
}

func outputPathFor(input string, s Settings, resolution string, total int) string {
	ext := "." + containerName(s)
	if containerName(s) == "jpeg" {
		ext = ".mp4"
	}
	dir := filepath.Dir(input)
	if s.OutputDirectory != "" {
		dir = s.OutputDirectory
	}
	base := strings.TrimSuffix(filepath.Base(input), filepath.Ext(input))
	if total > 1 {
		return filepath.Join(dir, resolution+s.OutputPrefix+base+ext)
	}
	return filepath.Join(dir, s.OutputPrefix+base+ext)
}

func containerName(s Settings) string {
	if s.Container == "" || s.Container == "auto" {
		return defaultContainer(s.Codec)
	}
	return s.Container
}

func defaultContainer(codec string) string {
	switch codec {
	case "vp9":
		return "webm"
	case "prores":
		return "mov"
	case "ffv1":
		return "mkv"
	default:
		return "mp4"
	}
}

func muxerName(s Settings) string {
	if containerName(s) == "mkv" {
		return "matroska"
	}
	return containerName(s)
}

func progressPercent(outTime string, duration float64) float64 {
	ms, _ := strconv.ParseFloat(outTime, 64)
	if duration <= 0 {
		return 1
	}
	return math.Min(99, (ms/1000000)/duration*100)
}

func stableID(path string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(path))))
	return hex.EncodeToString(sum[:])
}

func kb(v int) string {
	if v <= 0 {
		v = 1000
	}
	return strconv.Itoa(v) + "k"
}

func bitrateFor(s Settings, resolution string) (bitrate, maxrate, bufsize int) {
	if b, ok := s.BitrateByResolution[resolution]; ok && b.BitrateKbps > 0 {
		return b.BitrateKbps, b.MaxrateKbps, b.BufsizeKbps
	}
	return s.BitrateKbps, s.MaxrateKbps, s.BufsizeKbps
}
