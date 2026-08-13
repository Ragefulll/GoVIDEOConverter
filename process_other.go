//go:build !windows

package main

import (
	goruntime "runtime"

	"os/exec"
)

func hideCommandWindow(cmd *exec.Cmd) *exec.Cmd {
	return cmd
}

func cpuThreads() int {
	return goruntime.NumCPU()
}
