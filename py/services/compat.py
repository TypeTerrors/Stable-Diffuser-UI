from __future__ import annotations


def patch_transformers_torchvision() -> None:
    """
    Work around broken torchvision installs that raise exceptions at import time.

    Some environments ship a torchvision build that is discoverable (so
    `importlib.util.find_spec("torchvision")` succeeds) but crashes during import.
    Transformers treats torchvision as available based on discovery, then imports
    it unguarded in `transformers.image_utils`, which can prevent the app from
    starting even when torchvision isn't needed.
    """

    try:
        import transformers.utils.import_utils as import_utils
    except Exception:
        return

    original = getattr(import_utils, "is_torchvision_available", None)
    if not callable(original):
        return

    if getattr(original, "__name__", "") == "_safe_is_torchvision_available":
        return

    def _safe_is_torchvision_available() -> bool:
        try:
            discovered = bool(original())
        except Exception:
            return False
        if not discovered:
            return False
        try:
            import torchvision  # noqa: F401
        except Exception:
            return False
        return True

    import_utils.is_torchvision_available = _safe_is_torchvision_available

    try:
        import transformers.utils as utils

        utils.is_torchvision_available = _safe_is_torchvision_available
    except Exception:
        pass


def patch_torchaudio_stub() -> None:
    """
    Provide a minimal in-process `torchaudio` stub when the real library is absent.

    The NVIDIA PyTorch base image used by this repo ships a custom torch build for
    CUDA, but compatible `torchaudio` wheels are often not available on PyPI for
    that exact build. Some third-party libs (e.g. LTX) import `torchaudio` even
    when only audio decoding is used.

    This stub is only installed if importing `torchaudio` fails. If code paths
    require real torchaudio features (resampling / mel transforms), the stub will
    raise a clear RuntimeError at the callsite.
    """

    try:
        import torchaudio  # noqa: F401

        return
    except Exception:
        pass

    import importlib.machinery
    import sys
    import types

    if "torchaudio" in sys.modules:
        return

    def _missing(*_args, **_kwargs):
        raise RuntimeError(
            "torchaudio is not installed (or is incompatible with this torch build). "
            "Install a torchaudio build that matches the container's torch version, "
            "or disable features that require torchaudio."
        )

    functional = types.ModuleType("torchaudio.functional")
    functional.__spec__ = importlib.machinery.ModuleSpec("torchaudio.functional", loader=None)
    functional.resample = _missing

    transforms = types.ModuleType("torchaudio.transforms")
    transforms.__spec__ = importlib.machinery.ModuleSpec("torchaudio.transforms", loader=None)

    class MelSpectrogram:  # noqa: D401
        def __init__(self, *_args, **_kwargs) -> None:
            _missing()

        def __call__(self, *_args, **_kwargs):
            _missing()

    transforms.MelSpectrogram = MelSpectrogram

    torchaudio = types.ModuleType("torchaudio")
    torchaudio.__spec__ = importlib.machinery.ModuleSpec("torchaudio", loader=None, is_package=True)
    torchaudio.__path__ = []  # mark as package for importlib
    torchaudio.functional = functional
    torchaudio.transforms = transforms

    sys.modules["torchaudio"] = torchaudio
    sys.modules["torchaudio.functional"] = functional
    sys.modules["torchaudio.transforms"] = transforms
