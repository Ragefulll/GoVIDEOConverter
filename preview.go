package main

import (
	"bufio"
	"bytes"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var previewContentTypes = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".mov":  "video/quicktime",
	".webm": "video/webm",
	".ogv":  "video/ogg",
	".mkv":  "video/x-matroska",
}

var previewExts = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true,
	".webm": true, ".m4v": true, ".mpg": true, ".mpeg": true, ".m2ts": true, ".mts": true,
	".ts": true, ".3gp": true, ".ogv": true, ".mxf": true, ".vob": true,
}

func previewHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/preview" && r.URL.Path != "/preview/" {
		http.NotFound(w, r)
		return
	}
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	if !previewExts[strings.ToLower(filepath.Ext(p))] {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if ct := previewContentTypes[strings.ToLower(filepath.Ext(p))]; ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func tmpDirFor(path string) string {
	return filepath.Join(filepath.Dir(path), "tmp")
}

func previewProxyPath(path string) string {
	return filepath.Join(tmpDirFor(path), stableID(path)+".mp4")
}

func (a *App) trackTmpDir(path string) {
	dir := tmpDirFor(path)
	a.mu.Lock()
	if a.tmpDirs == nil {
		a.tmpDirs = map[string]struct{}{}
	}
	a.tmpDirs[dir] = struct{}{}
	a.mu.Unlock()
}

func (a *App) cleanupTmp() {
	a.mu.Lock()
	dirs := make([]string, 0, len(a.tmpDirs))
	for d := range a.tmpDirs {
		dirs = append(dirs, d)
	}
	a.tmpDirs = map[string]struct{}{}
	a.mu.Unlock()
	for _, d := range dirs {
		_ = os.RemoveAll(d)
	}
}

func (a *App) HasPreviewProxy(path string) (string, error) {
	proxy := previewProxyPath(path)
	info, err := os.Stat(proxy)
	if err != nil || info.Size() == 0 {
		return "", nil
	}
	if src, err := os.Stat(path); err == nil && src.ModTime().After(info.ModTime()) {
		return "", nil
	}
	return proxy, nil
}

func (a *App) MakePreviewProxy(path string) (string, error) {
	ffmpeg, ffprobe, err := resolveTools("")
	if err != nil {
		return "", errors.New("ffmpeg не найден")
	}
	meta, err := probeVideo(ffprobe, path)
	if err != nil {
		return "", err
	}
	if proxy, _ := a.HasPreviewProxy(path); proxy != "" {
		return proxy, nil
	}
	proxy := previewProxyPath(path)
	if err := os.MkdirAll(filepath.Dir(proxy), 0755); err != nil {
		return "", err
	}
	a.trackTmpDir(path)
	tmp := proxy + ".partial." + strconv.FormatInt(time.Now().UnixNano(), 36)
	filter := "scale=w='min(640,iw)':h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p"
	args := []string{
		"-hide_banner", "-nostdin", "-y", "-i", path,
		"-map", "0:v:0", "-map", "0:a:0?",
		"-vf", filter,
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
		"-c:a", "aac", "-b:a", "96k",
		"-movflags", "+faststart", "-fps_mode", "passthrough",
		"-f", "mp4",
		"-progress", "pipe:1", "-nostats", tmp,
	}
	cmd := newCommand(ffmpeg, args...)
	stdout, _ := cmd.StdoutPipe()
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return "", err
	}
	progress := map[string]string{}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		progress[parts[0]] = parts[1]
		if parts[0] == "progress" {
			pct := 1.0
			if meta.Duration > 0 {
				ms, _ := strconv.ParseFloat(progress["out_time_ms"], 64)
				pct = math.Min(100, ms/1000000/meta.Duration*100)
			}
			runtime.EventsEmit(a.ctx, "preview-proxy-progress", ProgressEvent{Progress: pct})
		}
	}
	if err := cmd.Wait(); err != nil {
		_ = os.Remove(tmp)
		detail := strings.TrimSpace(stderr.String())
		if i := strings.LastIndex(detail, "Error"); i >= 0 {
			detail = detail[i:]
		}
		if len(detail) > 300 {
			detail = detail[len(detail)-300:]
		}
		detail = strings.ReplaceAll(detail, "\n", " ")
		if detail != "" {
			return "", errors.New("не удалось создать превью: " + err.Error() + ": " + detail)
		}
		return "", errors.New("не удалось создать превью: " + err.Error())
	}
	_ = os.Remove(proxy)
	if err := os.Rename(tmp, proxy); err != nil {
		return "", err
	}
	return proxy, nil
}
