package mediator

import (
	"be/config"
	"be/internal/dependencies"
	"be/internal/services"
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

type App struct {
	api *services.Api
	rpc *dependencies.Rpc

	hub *services.Hub
	dl  *services.DownloaderService

	ctx    context.Context
	cancel context.CancelFunc
	// settings
	Config *config.Config
}

func NewApp(config config.Config) (*App, error) {

	rpc, err := dependencies.NewRpc(config.Rpc.Peer, config.Rpc.Port)
	if err != nil {
		return nil, fmt.Errorf("error creating newapp: %w", err)
	}

	api := services.NewApi(rpc, config.Api)

	ctx, cancel := context.WithCancel(context.Background())

	hub := services.NewHub()
	dl := services.NewDownloaderService(hub, config.Api.Dl, ctx)

	return &App{
		api:    api,
		rpc:    rpc,
		hub:    hub,
		dl:     dl,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

func (a *App) Start() {

	a.dl.Run(a.ctx)

	go a.api.Start()
}

func (a *App) Shutdown() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch

	a.cancel()
	a.dl.Shutdown()
	a.rpc.Close()
}
