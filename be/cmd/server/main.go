package main

import (
	"be/config"
	"be/internal/mediator"
	"strings"
	"time"

	"github.com/TypeTerrors/gonfig"
	"github.com/charmbracelet/log"
)

func main() {

	cfg, err := gonfig.Load[config.Config](
		gonfig.WithConfigFile("config/config.yaml"),
		gonfig.WithDotenv(".env"), // ignored if missing
		gonfig.WithStrict(),       // fail if ${VAR} has no value/default
	)
	if err != nil {
		log.Fatal(err)
	}

	setupLogger(cfg.Api.LogLevel)

	app, err := mediator.NewApp(cfg)
	if err != nil {
		log.Fatal(err)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func setupLogger(level string) {
	log.SetReportTimestamp(true)
	log.SetTimeFormat(time.RFC3339Nano)

	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		log.SetLevel(log.DebugLevel)
	case "info", "":
		log.SetLevel(log.InfoLevel)
	case "warn", "warning":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	default:
		log.SetLevel(log.InfoLevel)
		log.Warn("unknown log level; defaulting to info", "level", level)
	}
}
