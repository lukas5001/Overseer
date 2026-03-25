VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

LDFLAGS = -X github.com/lukas5001/overseer-agent/internal/version.Version=$(VERSION) \
          -X github.com/lukas5001/overseer-agent/internal/version.BuildTime=$(BUILD_TIME) \
          -X github.com/lukas5001/overseer-agent/internal/version.GitCommit=$(GIT_COMMIT)

.PHONY: build-linux build-windows build-all clean

build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o bin/overseer-agent ./cmd/overseer-agent

build-windows:
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/overseer-agent.exe ./cmd/overseer-agent

build-all: build-linux build-windows

package-linux: build-linux
	tar -czf bin/overseer-agent-linux-amd64.tar.gz -C bin overseer-agent

package-windows: build-windows
	cd bin && zip overseer-agent-windows-amd64.zip overseer-agent.exe

clean:
	rm -rf bin/
