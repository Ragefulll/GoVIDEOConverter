package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestPreviewProxyServing(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "sample.mp4")
	content := []byte("fake-mp4-content-xyz")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}
	proxy := previewProxyPath(src)
	if err := os.MkdirAll(filepath.Dir(proxy), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(proxy, content, 0644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(previewHandler))
	defer srv.Close()

	u := srv.URL + "/preview/?path=" + url.QueryEscape(proxy)

	res, err := http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("content-type = %q", ct)
	}
	got, _ := io.ReadAll(res.Body)
	if string(got) != string(content) {
		t.Fatalf("body mismatch: %q", got)
	}
}

func TestProbeVideoParsesNumericStrings(t *testing.T) {
	const sample = `{
  "streams": [
    {
      "index": 0,
      "codec_type": "video",
      "codec_name": "h264",
      "width": 1920,
      "height": 1080,
      "pix_fmt": "yuv420p",
      "level": "40",
      "has_b_frames": 2,
      "bits_per_raw_sample": "8",
      "nb_frames": "125",
      "avg_frame_rate": "25/1",
      "r_frame_rate": "25/1"
    },
    {
      "index": 1,
      "codec_type": "audio",
      "codec_name": "aac",
      "sample_rate": "48000",
      "channels": 2,
      "bits_per_sample": "16",
      "nb_frames": "1024"
    }
  ],
  "format": {
    "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
    "format_long_name": "QuickTime / MOV",
    "duration": "5.000000",
    "bit_rate": "1234567",
    "size": "771604",
    "probe_score": 100,
    "tags": {"creation_time": "2024-01-01T00:00:00.000000Z"}
  }
}`
	var data ffprobeOutput
	if err := json.Unmarshal([]byte(sample), &data); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if len(data.Streams) != 2 {
		t.Fatalf("streams = %d", len(data.Streams))
	}
	if data.Streams[0].Level != 40 || data.Streams[0].BitsPerRawSample != 8 {
		t.Fatalf("video numeric fields = level %v bprs %v", data.Streams[0].Level, data.Streams[0].BitsPerRawSample)
	}
	if data.Streams[1].Channels != 2 || data.Streams[1].BitsPerSample != 16 {
		t.Fatalf("audio numeric fields = channels %v bps %v", data.Streams[1].Channels, data.Streams[1].BitsPerSample)
	}
}
