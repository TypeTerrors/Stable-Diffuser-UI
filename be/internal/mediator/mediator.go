package mediator

import (
	"be/config"
	"be/internal/dependencies"
	"be/internal/services"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type App struct {
	api *services.Api
	rpc *dependencies.Rpc
	// settings
	Config *config.Config
}

func parseDurationish(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, fmt.Errorf("duration is required")
	}

	if d, err := time.ParseDuration(raw); err == nil {
		if d <= 0 {
			return 0, fmt.Errorf("duration must be > 0")
		}
		return d, nil
	}

	// Back-compat: allow bare seconds like "240".
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return 0, fmt.Errorf("invalid duration %q (expected e.g. 240s, 30m, or bare seconds)", raw)
	}

	return time.Duration(seconds) * time.Second, nil
}

func NewApp(cfg config.Config) (*App, error) {

	dialTimeout, err := parseDurationish(cfg.Rpc.DialTimeout)
	if err != nil {
		return nil, fmt.Errorf("invalid rpc.dial_timeout: %w", err)
	}
	t2iTimeout, err := parseDurationish(cfg.Rpc.T2ITimeout)
	if err != nil {
		return nil, fmt.Errorf("invalid rpc.t2i_timeout: %w", err)
	}
	i2vTimeout, err := parseDurationish(cfg.Rpc.I2VTimeout)
	if err != nil {
		return nil, fmt.Errorf("invalid rpc.i2v_timeout: %w", err)
	}

	rpc, err := dependencies.NewRpc(dependencies.Config{
		Peer:            cfg.Rpc.Peer,
		Port:            cfg.Rpc.Port,
		DialTimeout:     dialTimeout,
		T2ITimeout:      t2iTimeout,
		I2VTimeout:      i2vTimeout,
		MaxMsgSizeBytes: cfg.Rpc.MaxMsgSizeMB * 1024 * 1024,
	})
	if err != nil {
		return nil, fmt.Errorf("error creating newapp: %w", err)
	}

	api := services.NewApi(cfg.Api.Port, rpc, cfg.Api.AllowedOrigins)

	return &App{
		api:    api,
		rpc:    rpc,
		Config: &cfg,
	}, nil
}

func (a *App) Start() {
	a.api.Start()
}

func (a *App) Shutdown() {
	if a.rpc != nil {
		a.rpc.Close()
	}
}
