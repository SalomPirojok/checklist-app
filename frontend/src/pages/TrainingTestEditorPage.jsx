import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

function emptyQuestion() {
    return { question_text: '', options: [{ option_text: '', is_correct: true }, { option_text: '', is_correct: false }] };
}

export default function TrainingTestEditorPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();

    const [passingScorePercent, setPassingScorePercent] = useState(80);
    const [questions, setQuestions] = useState([emptyQuestion()]);
    const [hasExistingTest, setHasExistingTest] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api(`/api/training/${id}/test`)
            .then((res) => {
                if (cancelled || !res.test) return;
                setHasExistingTest(true);
                setPassingScorePercent(res.test.passing_score_percent);
                setQuestions(
                    res.test.questions.map((q) => ({
                        question_text: q.question_text,
                        options: q.options.map((o) => ({ option_text: o.option_text, is_correct: o.is_correct })),
                    }))
                );
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    function updateQuestionText(qIndex, value) {
        setQuestions((prev) => prev.map((q, i) => (i === qIndex ? { ...q, question_text: value } : q)));
    }

    function updateOptionText(qIndex, oIndex, value) {
        setQuestions((prev) =>
            prev.map((q, i) =>
                i === qIndex
                    ? { ...q, options: q.options.map((o, j) => (j === oIndex ? { ...o, option_text: value } : o)) }
                    : q
            )
        );
    }

    function setCorrectOption(qIndex, oIndex) {
        setQuestions((prev) =>
            prev.map((q, i) =>
                i === qIndex ? { ...q, options: q.options.map((o, j) => ({ ...o, is_correct: j === oIndex })) } : q
            )
        );
    }

    function addOption(qIndex) {
        setQuestions((prev) =>
            prev.map((q, i) => (i === qIndex ? { ...q, options: [...q.options, { option_text: '', is_correct: false }] } : q))
        );
    }

    function removeOption(qIndex, oIndex) {
        setQuestions((prev) =>
            prev.map((q, i) => (i === qIndex ? { ...q, options: q.options.filter((_, j) => j !== oIndex) } : q))
        );
    }

    function addQuestion() {
        setQuestions((prev) => [...prev, emptyQuestion()]);
    }

    function removeQuestion(qIndex) {
        setQuestions((prev) => prev.filter((_, i) => i !== qIndex));
    }

    async function handleSave(e) {
        e.preventDefault();
        setError(null);

        if (questions.length === 0) {
            setError('Добавьте хотя бы один вопрос.');
            return;
        }
        for (const q of questions) {
            if (!q.question_text.trim()) {
                setError('У каждого вопроса должен быть текст.');
                return;
            }
            if (q.options.length < 2) {
                setError('У каждого вопроса должно быть минимум 2 варианта ответа.');
                return;
            }
            if (q.options.some((o) => !o.option_text.trim())) {
                setError('У каждого варианта ответа должен быть текст.');
                return;
            }
            if (q.options.filter((o) => o.is_correct).length !== 1) {
                setError('В каждом вопросе должен быть ровно один правильный вариант.');
                return;
            }
        }

        setSaving(true);
        try {
            await api(`/api/training/${id}/test`, {
                method: 'PUT',
                body: { passing_score_percent: Number(passingScorePercent), questions },
            });
            navigate(`/training/${id}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteTest() {
        if (!confirm('Удалить тест целиком?')) return;
        try {
            await api(`/api/training/${id}/test`, { method: 'DELETE' });
            navigate(`/training/${id}`);
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <p>Загрузка...</p>;

    return (
        <div className="page">
            <h1>{hasExistingTest ? 'Редактирование теста' : 'Новый тест'}</h1>
            <form onSubmit={handleSave} className="form">
                <label className="field">
                    <span>Проходной балл (%)</span>
                    <input
                        type="number"
                        min="1"
                        max="100"
                        required
                        value={passingScorePercent}
                        onChange={(e) => setPassingScorePercent(e.target.value)}
                    />
                </label>

                {questions.map((q, qIndex) => (
                    <div key={qIndex} className="modal" style={{ marginBottom: '12px' }}>
                        <label className="field">
                            <span>Вопрос {qIndex + 1}</span>
                            <input
                                type="text"
                                required
                                value={q.question_text}
                                onChange={(e) => updateQuestionText(qIndex, e.target.value)}
                            />
                        </label>

                        {q.options.map((o, oIndex) => (
                            <div key={oIndex} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <input
                                    type="radio"
                                    name={`correct-${qIndex}`}
                                    checked={o.is_correct}
                                    onChange={() => setCorrectOption(qIndex, oIndex)}
                                />
                                <input
                                    type="text"
                                    placeholder="Вариант ответа"
                                    required
                                    value={o.option_text}
                                    onChange={(e) => updateOptionText(qIndex, oIndex, e.target.value)}
                                    style={{ flex: 1 }}
                                />
                                {q.options.length > 2 && (
                                    <button type="button" className="btn btn--ghost btn--danger" onClick={() => removeOption(qIndex, oIndex)}>
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        <button type="button" className="btn btn--ghost" onClick={() => addOption(qIndex)}>
                            + Вариант ответа
                        </button>

                        {questions.length > 1 && (
                            <div style={{ marginTop: '8px' }}>
                                <button type="button" className="btn btn--ghost btn--danger" onClick={() => removeQuestion(qIndex)}>
                                    Удалить вопрос
                                </button>
                            </div>
                        )}
                    </div>
                ))}

                <button type="button" className="btn btn--ghost" onClick={addQuestion}>
                    + Добавить вопрос
                </button>

                {error && <p className="error-text">{error}</p>}

                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate(`/training/${id}`)}>
                        Отмена
                    </button>
                    {hasExistingTest && (
                        <button type="button" className="btn btn--ghost btn--danger" onClick={handleDeleteTest}>
                            Удалить тест
                        </button>
                    )}
                    <button type="submit" className="btn" disabled={saving}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
}
