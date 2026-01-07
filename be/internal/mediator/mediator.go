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
	"time"
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

	ctx, cancel := context.WithCancel(context.Background())

	hub := services.NewHub()
	dl := services.NewDownloaderService(hub, config.Api.Dl, ctx)
	api := services.NewApi(rpc, config.Api, hub, dl)

	return &App{
		api:    api,
		rpc:    rpc,
		hub:    hub,
		dl:     dl,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

func (a *App) Run() error {
	a.dl.Run()

	errCh := make(chan error, 1)
	go func() {
		errCh <- a.api.Start()
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case <-sigCh:
		a.Shutdown()
		return nil
	case err := <-errCh:
		a.Shutdown()
		return err
	case <-a.ctx.Done():
		a.Shutdown()
		return a.ctx.Err()
	}
}

func (a *App) Shutdown() {

	a.cancel()
	a.dl.Shutdown()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = a.api.Shutdown(shutdownCtx)
	cancel()

	a.hub.Shutdown()
	a.rpc.Close()
}
