package main

import (
	"context"
	"os/exec"
)

func newCommand(name string, args ...string) *exec.Cmd {
	return hideCommandWindow(exec.Command(name, args...))
}

func newCommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return hideCommandWindow(exec.CommandContext(ctx, name, args...))
}
