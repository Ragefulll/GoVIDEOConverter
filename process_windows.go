//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func hideCommandWindow(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

func cpuThreads() int {
	const allProcessorGroups = 0xFFFF
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetActiveProcessorCount")
	n, _, _ := proc.Call(allProcessorGroups)
	if n == 0 {
		return 0
	}
	return int(n)
}
