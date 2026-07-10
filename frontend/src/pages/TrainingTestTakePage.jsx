import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { SkeletonRows } from '../components/Skeleton';
import { hapticError, hapticSuccess } from '../lib/haptics';

export default function TrainingTestTakePage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();

    const [test, setTest] = useState(null);
    const [answers, setAnswers] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api(`/api/training/${id}/test`)
            .then((res) => {
                if (cancelled) return;
                if (!res.test) {
                    setError('У этого материала пока нет теста.');
                } else {
                    setTest(res.test);
                }
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    function selectOption(questionId, optionId) {
        setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);

        const unanswered = test.questions.filter((q) => !answers[q.id]);
        if (unanswered.length > 0) {
            setError('Ответьте на все вопросы перед отправкой.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await api(`/api/training/${id}/test/attempts`, {
                method: 'POST',
                body: {
                    answers: test.questions.map((q) => ({ question_id: q.id, selected_option_id: answers[q.id] })),
                },
            });
            setResult(res);
            if (res.attempt.passed) hapticSuccess();
            else hapticError();
        } catch (err) {
            setError(err.message);
            hapticError();
        } finally {
            setSubmitting(false);
        }
    }

    function handleRetry() {
        setAnswers({});
        setResult(null);
    }

    if (loading) {
        return (
            <div className="page">
                <div className="skeleton skeleton-text" style={{ height: 24, width: '30%', marginBottom: 16 }} />
                <SkeletonRows count={4} />
            </div>
        );
    }
    if (error && !test) return <p className="error-text">{error}</p>;

    if (result) {
        const resultByQuestion = new Map(result.results.map((r) => [r.question_id, r]));
        return (
            <div className="page">
                <h1>Результат теста</h1>
                <p className="hint">
                    Результат: {result.attempt.score_percent}% — {result.attempt.passed ? 'пройден' : 'не пройден'}
                </p>

                {test.questions.map((q) => {
                    const r = resultByQuestion.get(q.id);
                    return (
                        <div key={q.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            <div className="list-row__title">{q.question_text}</div>
                            {q.options.map((o) => {
                                const isSelected = r.selected_option_id === o.id;
                                const isCorrectOption = r.correct_option_id === o.id;
                                let style = {};
                                if (isCorrectOption) style = { color: 'var(--status-good)', fontWeight: 600 };
                                else if (isSelected && !r.is_correct) style = { color: 'var(--status-critical)', textDecoration: 'line-through' };
                                return (
                                    <div key={o.id} style={style}>
                                        {isSelected ? '● ' : '○ '}
                                        {o.option_text}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate(`/training/${id}`)}>
                        Назад
                    </button>
                    <button type="button" className="btn" onClick={handleRetry}>
                        Пройти снова
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <h1>Тест</h1>
            <form onSubmit={handleSubmit} className="form">
                {test.questions.map((q, qIndex) => (
                    <div key={q.id} className="modal" style={{ marginBottom: '12px' }}>
                        <div className="list-row__title">
                            {qIndex + 1}. {q.question_text}
                        </div>
                        {q.options.map((o) => (
                            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                <input
                                    type="radio"
                                    name={`question-${q.id}`}
                                    checked={answers[q.id] === o.id}
                                    onChange={() => selectOption(q.id, o.id)}
                                />
                                {o.option_text}
                            </label>
                        ))}
                    </div>
                ))}

                {error && <p className="error-text">{error}</p>}

                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate(`/training/${id}`)}>
                        Отмена
                    </button>
                    <button type="submit" className="btn" disabled={submitting}>
                        {submitting ? 'Отправка...' : 'Завершить тест'}
                    </button>
                </div>
            </form>
        </div>
    );
}
