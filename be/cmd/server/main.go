package main

import (
	"be/config"
	"be/internal/mediator"
	"log"

	"github.com/TypeTerrors/gonfig"
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

	app, err := mediator.NewApp(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer app.Shutdown()

	app.Start()
}
