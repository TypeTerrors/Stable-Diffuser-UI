package utils

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

func FileNameFromCd(cd string) string {
	_, params, err := mime.ParseMediaType(cd)
	if err != nil {
		return ""
	}
	fn := strings.TrimSpace(params["filename"])
	fn = strings.ReplaceAll(fn, string(os.PathSeparator), "_")
	return fn
}

// prevents directory traversal; only writes under baseDir
func SafeSubdir(base, subdir string) (string, error) {
	subdir = strings.TrimSpace(subdir)
	subdir = strings.TrimPrefix(subdir, "/")
	subdir = strings.TrimPrefix(subdir, "\\")
	clean := filepath.Clean(subdir)

	if clean == "." || clean == "" {
		return filepath.Abs(base)
	}

	joined := filepath.Join(base, clean)

	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	joinedAbs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}

	sep := string(os.PathSeparator)
	if !(joinedAbs == baseAbs || strings.HasPrefix(joinedAbs, baseAbs+sep)) {
		return "", errors.New("path traversal detected")
	}
	return joinedAbs, nil
}

func NewJobID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
