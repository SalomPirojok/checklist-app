import { useEffect, useRef, useState } from 'react';
import { hapticTap } from '../lib/haptics';

export default function SignaturePad({ onSave, saving, disabled }) {
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const [isEmpty, setIsEmpty] = useState(true);

    function getPoint(canvas, source) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((source.clientX - rect.left) * canvas.width) / rect.width,
            y: ((source.clientY - rect.top) * canvas.height) / rect.height,
        };
    }

    function startDrawAt(canvas, source) {
        if (disabled) return;
        drawingRef.current = true;
        const { x, y } = getPoint(canvas, source);
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(x, y);
    }

    function drawTo(canvas, source) {
        if (!drawingRef.current || disabled) return;
        const { x, y } = getPoint(canvas, source);
        const ctx = canvas.getContext('2d');
        ctx.lineTo(x, y);
        ctx.stroke();
        setIsEmpty(false);
    }

    function endDraw() {
        drawingRef.current = false;
    }

    // Mouse events aren't subject to the passive-listener quirk below, so plain
    // React synthetic handlers are fine for them.
    function handleMouseDown(e) {
        startDrawAt(canvasRef.current, e);
    }
    function handleMouseMove(e) {
        drawTo(canvasRef.current, e);
    }

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000000';

        // React attaches its synthetic touchstart/touchmove listeners as passive,
        // so calling preventDefault() from JSX onTouch* handlers is silently a
        // no-op — the page (or, inside Telegram, its native swipe-to-close
        // gesture) can still steal the gesture instead of the canvas drawing on
        // it. Native listeners registered with { passive: false } fix that.
        function onTouchStart(e) {
            e.preventDefault();
            startDrawAt(canvas, e.touches[0]);
        }
        function onTouchMove(e) {
            e.preventDefault();
            drawTo(canvas, e.touches[0]);
        }
        function onTouchEnd(e) {
            e.preventDefault();
            endDraw();
        }

        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

        return () => {
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('touchcancel', onTouchEnd);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled]);

    function handleClear() {
        const canvas = canvasRef.current;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        setIsEmpty(true);
    }

    function handleSave() {
        canvasRef.current.toBlob((blob) => {
            if (blob) {
                hapticTap();
                onSave(blob);
            }
        }, 'image/png');
    }

    return (
        <div className="signature-pad">
            <canvas
                ref={canvasRef}
                width={320}
                height={150}
                className="signature-pad__canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
            />
            <div className="form-actions">
                <button type="button" className="btn btn--ghost" onClick={handleClear} disabled={disabled || isEmpty}>
                    Очистить
                </button>
                <button type="button" className="btn btn--large" onClick={handleSave} disabled={disabled || isEmpty || saving}>
                    {saving ? 'Сохранение...' : 'Сохранить подпись'}
                </button>
            </div>
        </div>
    );
}
