package main

import (
	"context"
	"embed"
	"fmt"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(appVersion)
		return
	}
	if isSelfUpdate() {
		if err := runSelfUpdate(); err != nil {
			println("Update error:", err.Error())
			os.Exit(1)
		}
		return
	}

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "GoVIDEOConverter",
		Width:  1900,
		Height: 1200,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: http.HandlerFunc(previewHandler),
		},
		BackgroundColour: &options.RGBA{R: 23, G: 24, B: 28, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       func(ctx context.Context) { app.cleanupTmp() },
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
