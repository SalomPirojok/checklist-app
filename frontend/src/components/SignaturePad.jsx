import { useEffect, useRef, useState } from 'react';

export default function SignaturePad({ onSave, saving, disabled }) {
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const [isEmpty, setIsEmpty] = useState(true);

    useEffect(() => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000000';
    }, []);

    function getPoint(e) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const source = e.touches?.[0] || e;
        return {
            x: ((source.clientX - rect.left) * canvas.width) / rect.width,
            y: ((source.clientY - rect.top) * canvas.height) / rect.height,
        };
    }

    function startDraw(e) {
        if (disabled) return;
        e.preventDefault();
        drawingRef.current = true;
        const { x, y } = getPoint(e);
        const ctx = canvasRef.current.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(x, y);
    }

    function draw(e) {
        if (!drawingRef.current || disabled) return;
        e.preventDefault();
        const { x, y } = getPoint(e);
        const ctx = canvasRef.current.getContext('2d');
        ctx.lineTo(x, y);
        ctx.stroke();
        setIsEmpty(false);
    }

    function endDraw() {
        drawingRef.current = false;
    }

    function handleClear() {
        const canvas = canvasRef.current;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        setIsEmpty(true);
    }

    function handleSave() {
        canvasRef.current.toBlob((blob) => {
            if (blob) onSave(blob);
        }, 'image/png');
    }

    return (
        <div className="signature-pad">
            <canvas
                ref={canvasRef}
                width={320}
                height={150}
                className="signature-pad__canvas"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
            />
            <div className="form-actions">
                <button type="button" className="btn btn--ghost" onClick={handleClear} disabled={disabled || isEmpty}>
                    Очистить
                </button>
                <button type="button" className="btn" onClick={handleSave} disabled={disabled || isEmpty || saving}>
                    {saving ? 'Сохранение...' : 'Сохранить подпись'}
                </button>
            </div>
        </div>
    );
}
