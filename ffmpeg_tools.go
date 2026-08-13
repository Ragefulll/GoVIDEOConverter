package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const ffmpegDownloadURL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

type FFmpegStatus struct {
	Installed bool   `json:"installed"`
	FFmpeg    string `json:"ffmpeg"`
	FFprobe   string `json:"ffprobe"`
	Version   string `json:"version"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

type InstallProgressEvent struct {
	Phase    string  `json:"phase"`
	Progress float64 `json:"progress"`
	Detail   string  `json:"detail"`
}

func ffmpegFileName() string {
	if runtime.GOOS == "windows" {
		return "ffmpeg.exe"
	}
	return "ffmpeg"
}

func ffprobeFileName() string {
	if runtime.GOOS == "windows" {
		return "ffprobe.exe"
	}
	return "ffprobe"
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func appConfigDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base, _ = os.UserHomeDir()
	}
	return filepath.Join(base, "GoVIDEOConverter")
}

func configFilePath() string {
	return filepath.Join(appConfigDir(), "config.json")
}

func appToolsDir() string {
	return filepath.Join(appConfigDir(), "ffmpeg")
}

func storedFFmpegPath() string {
	raw, err := os.ReadFile(configFilePath())
	if err != nil {
		return ""
	}
	var cfg map[string]string
	if json.Unmarshal(raw, &cfg) != nil {
		return ""
	}
	return cfg["ffmpegPath"]
}

func saveFFmpegPath(path string) error {
	cfg := map[string]string{}
	if raw, err := os.ReadFile(configFilePath()); err == nil {
		_ = json.Unmarshal(raw, &cfg)
	}
	cfg["ffmpegPath"] = path
	raw, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.MkdirAll(filepath.Dir(configFilePath()), 0755); err != nil {
		return err
	}
	return os.WriteFile(configFilePath(), raw, 0644)
}

func bundledToolsDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	for _, candidate := range []string{
		filepath.Join(dir, "ffmpeg", "bin"),
		filepath.Join(dir, "ffmpeg"),
		filepath.Join(dir, "bin"),
		dir,
	} {
		if fileExists(filepath.Join(candidate, ffmpegFileName())) &&
			fileExists(filepath.Join(candidate, ffprobeFileName())) {
			return candidate, nil
		}
	}
	return "", errors.New("встроенный FFmpeg не найден")
}

func downloadToolsDir() (string, error) {
	dir := filepath.Join(appToolsDir(), "bin")
	if fileExists(filepath.Join(dir, ffmpegFileName())) &&
		fileExists(filepath.Join(dir, ffprobeFileName())) {
		return dir, nil
	}
	return "", errors.New("FFmpeg не установлен")
}

func checkDir(dir string) (string, string, bool) {
	f := filepath.Join(dir, ffmpegFileName())
	p := filepath.Join(dir, ffprobeFileName())
	if fileExists(f) && fileExists(p) {
		return f, p, true
	}
	return "", "", false
}

func checkPATH() (string, string, bool) {
	f, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", "", false
	}
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		return "", "", false
	}
	return f, p, true
}

func findTools(explicit string) (ffmpegPath, ffprobePath, source string, err error) {
	if explicit != "" {
		base := explicit
		if info, statErr := os.Stat(explicit); statErr == nil && info.IsDir() {
			base = filepath.Join(explicit, ffmpegFileName())
		}
		probe := filepath.Join(filepath.Dir(base), ffprobeFileName())
		if !fileExists(base) {
			return "", "", "", fmt.Errorf("не найден %s по пути %s", ffmpegFileName(), base)
		}
		if !fileExists(probe) {
			return "", "", "", fmt.Errorf("не найден %s рядом с %s", ffprobeFileName(), base)
		}
		return base, probe, "manual", nil
	}
	if stored := storedFFmpegPath(); stored != "" {
		if f, p, ok := checkDir(stored); ok {
			return f, p, "manual", nil
		}
	}
	if f, p, ok := checkPATH(); ok {
		return f, p, "PATH", nil
	}
	if dir, err := bundledToolsDir(); err == nil {
		return filepath.Join(dir, ffmpegFileName()), filepath.Join(dir, ffprobeFileName()), "bundled", nil
	}
	if dir, err := downloadToolsDir(); err == nil {
		return filepath.Join(dir, ffmpegFileName()), filepath.Join(dir, ffprobeFileName()), "downloaded", nil
	}
	return "", "", "", errors.New("FFmpeg не найден. Установите его автоматически или укажите путь вручную.")
}

func resolveTools(explicit string) (string, string, error) {
	f, p, _, err := findTools(explicit)
	return f, p, err
}

func ffmpegVersion(ffmpegPath string) string {
	cmd := newCommand(ffmpegPath, "-hide_banner", "-version")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	line := strings.SplitN(string(out), "\n", 2)[0]
	return strings.TrimSpace(line)
}

func (a *App) CheckFFmpeg() FFmpegStatus {
	f, p, source, err := findTools("")
	if err != nil {
		return FFmpegStatus{Message: err.Error()}
	}
	return FFmpegStatus{
		Installed: true,
		FFmpeg:    f,
		FFprobe:   p,
		Version:   ffmpegVersion(f),
		Source:    source,
		Message:   "OK",
	}
}

func (a *App) PickFFmpeg() (FFmpegStatus, error) {
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Выберите папку с ffmpeg и ffprobe",
	})
	if err != nil {
		return FFmpegStatus{}, err
	}
	if dir == "" {
		return a.CheckFFmpeg(), nil
	}
	exeDir := dir
	if !fileExists(filepath.Join(exeDir, ffmpegFileName())) {
		if fileExists(filepath.Join(exeDir, "bin", ffmpegFileName())) {
			exeDir = filepath.Join(exeDir, "bin")
		} else {
			return a.CheckFFmpeg(), fmt.Errorf("в выбранной папке не найден %s", ffmpegFileName())
		}
	}
	if err := saveFFmpegPath(exeDir); err != nil {
		return a.CheckFFmpeg(), err
	}
	return a.CheckFFmpeg(), nil
}

func (a *App) InstallFFmpeg() error {
	a.ffmpegMu.Lock()
	if a.installing {
		a.ffmpegMu.Unlock()
		return errors.New("установка уже выполняется")
	}
	a.installing = true
	a.ffmpegMu.Unlock()
	defer func() {
		a.ffmpegMu.Lock()
		a.installing = false
		a.ffmpegMu.Unlock()
	}()

	target := appToolsDir()
	if err := os.MkdirAll(target, 0755); err != nil {
		return err
	}

	zipPath := filepath.Join(os.TempDir(), fmt.Sprintf("ffmpeg-install-%d.zip", time.Now().UnixNano()))
	defer os.Remove(zipPath)

	a.emitInstall("Скачивание FFmpeg...", 0, "Подключение к серверу...")
	if err := a.downloadFile(ffmpegDownloadURL, zipPath); err != nil {
		return err
	}

	a.emitInstall("Распаковка FFmpeg...", 95, "Извлечение ffmpeg.exe и ffprobe.exe...")
	if err := extractFFmpeg(zipPath, target); err != nil {
		return err
	}

	a.emitInstall("Готово", 100, "FFmpeg установлен")
	wruntime.EventsEmit(a.ctx, "ffmpeg-installed")
	return nil
}

func (a *App) emitInstall(phase string, progress float64, detail string) {
	wruntime.EventsEmit(a.ctx, "ffmpeg-install-progress", InstallProgressEvent{
		Phase: phase, Progress: progress, Detail: detail,
	})
}

func (a *App) downloadFile(url, dest string) error {
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("не удалось начать загрузку: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ошибка загрузки: HTTP %d", resp.StatusCode)
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	var written int64
	buf := make([]byte, 256*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := out.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			if total > 0 {
				pct := float64(written) / float64(total) * 95
				detail := fmt.Sprintf("%.1f / %.1f МБ", float64(written)/1024/1024, float64(total)/1024/1024)
				a.emitInstall("Скачивание FFmpeg...", pct, detail)
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func extractFFmpeg(zipPath, target string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()

	var ffmpegEntry, ffprobeEntry string
	for _, f := range zr.File {
		base := filepath.Base(filepath.ToSlash(f.Name))
		switch base {
		case ffmpegFileName():
			ffmpegEntry = f.Name
		case ffprobeFileName():
			ffprobeEntry = f.Name
		}
	}
	if ffmpegEntry == "" || ffprobeEntry == "" {
		return errors.New("в архиве не найдены ffmpeg и ffprobe")
	}

	if err := copyZipEntry(zr, ffmpegEntry, filepath.Join(target, "bin", ffmpegFileName())); err != nil {
		return err
	}
	return copyZipEntry(zr, ffprobeEntry, filepath.Join(target, "bin", ffprobeFileName()))
}

func copyZipEntry(zr *zip.ReadCloser, name, dest string) error {
	var found *zip.File
	for _, f := range zr.File {
		if f.Name == name {
			found = f
			break
		}
	}
	if found == nil {
		return fmt.Errorf("запись %s не найдена в архиве", name)
	}
	src, err := found.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}
