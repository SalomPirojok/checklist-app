import { useEffect, useRef, useState } from 'react';
import { hapticError, hapticTap } from '../lib/haptics';

// A real in-app camera instead of <input type="file" capture>, which on
// Android Chrome/WebView (including inside Telegram) is only a *hint* -- the
// system can still offer the gallery, letting an employee submit a photo
// that isn't actually them, right now, at the workplace. getUserMedia leaves
// no such escape hatch: there is no gallery button in this UI at all.
export default function CameraCapture({ facingMode = 'environment', onCapture, onClose }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [status, setStatus] = useState('requesting'); // requesting | ready | denied | unsupported
    const [capturing, setCapturing] = useState(false);

    useEffect(() => {
        let cancelled = false;

        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus('unsupported');
            return undefined;
        }

        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false })
            .then((stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
                setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('denied');
            });

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        };
    }, [facingMode]);

    function stopStream() {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }

    function handleClose() {
        stopStream();
        onClose();
    }

    function handleCapture() {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || capturing) return;

        setCapturing(true);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    setCapturing(false);
                    return;
                }
                hapticTap();
                stopStream();
                onCapture(blob);
            },
            'image/jpeg',
            0.9
        );
    }

    return (
        <div className="camera-capture">
            {/* Always mounted (never conditional on `status`) so the ref exists
                the moment getUserMedia resolves -- otherwise assigning
                srcObject would race a video element that hasn't mounted yet. */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                hidden={status !== 'ready'}
                className={`camera-capture__video${facingMode === 'user' ? ' camera-capture__video--mirrored' : ''}`}
            />
            <canvas ref={canvasRef} hidden />

            <button type="button" className="camera-capture__close" onClick={handleClose} aria-label="Закрыть">
                ✕
            </button>

            {status === 'requesting' && (
                <div className="camera-capture__message">
                    <p>Запрашиваем доступ к камере…</p>
                </div>
            )}

            {status === 'denied' && (
                <div className="camera-capture__message">
                    <p>
                        Нет доступа к камере. Для этой функции обязательно нужна камера — разрешите доступ в настройках
                        Telegram или браузера и попробуйте снова.
                    </p>
                    <button
                        type="button"
                        className="btn btn--large"
                        onClick={() => {
                            hapticError();
                            handleClose();
                        }}
                    >
                        Закрыть
                    </button>
                </div>
            )}

            {status === 'unsupported' && (
                <div className="camera-capture__message">
                    <p>Это устройство или браузер не поддерживает доступ к камере.</p>
                    <button type="button" className="btn btn--large" onClick={handleClose}>
                        Закрыть
                    </button>
                </div>
            )}

            {status === 'ready' && (
                <div className="camera-capture__controls">
                    <button
                        type="button"
                        className="camera-capture__shutter"
                        onClick={handleCapture}
                        disabled={capturing}
                        aria-label="Сделать снимок"
                    />
                </div>
            )}
        </div>
    );
}
