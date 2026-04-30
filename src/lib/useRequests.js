/**
 * useRequests — централизованный хук для управления списком заявок.
 *
 * Реализует паттерн Optimistic UI:
 * - UI обновляется МГНОВЕННО (optimistic update)
 * - запрос к серверу идёт фоново
 * - при ошибке сети — откат состояния + уведомление
 *
 * Исключает повторные fetch при смене screen:
 * данные жёстко закешированы в памяти после первой загрузки.
 */

import { useState, useCallback, useRef } from 'react';
import { authFetch } from './api.js';

export function useRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const loadedRef = useRef(false); // не перезагружаем если уже грузили

  /** Полная (первичная) загрузка. Не вызывается повторно если данные уже есть. */
  const load = useCallback(async (force = false) => {
    if (loadedRef.current && !force) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/my-requests');
      const data = await res.json();
      if (Array.isArray(data)) {
        setRequests(data);
        loadedRef.current = true;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Принудительная перезагрузка (после create нового) */
  const reload = useCallback(() => load(true), [load]);

  /**
   * Оптимистическое удаление.
   * 1. Сразу убираем из UI
   * 2. Отправляем запрос
   * 3. Если ошибка — восстанавливаем
   */
  const optimisticDelete = useCallback(async (req, onError) => {
    const prevRequests = requests;
    // Optimistic update
    setRequests(prev => prev.filter(r => r.ID !== req.ID));

    try {
      const res = await authFetch('/api/requests/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.ID }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Откат при ошибке
      setRequests(prevRequests);
      onError?.(e.message || 'Ошибка удаления заявки');
    }
  }, [requests]);

  /**
   * Оптимистическое изменение ФИО.
   */
  const optimisticEditFio = useCallback(async (req, newFio, onError) => {
    const prevRequests = requests;
    // Optimistic update
    setRequests(prev =>
      prev.map(r =>
        r.ID === req.ID
          ? { ...r, full_name: newFio.trim() }
          : r
      )
    );

    try {
      const res = await authFetch('/api/requests/edit-fio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.ID, newFio }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setRequests(prevRequests);
      onError?.(e.message || 'Ошибка изменения ФИО');
    }
  }, [requests]);

  /**
   * Оптимистическое изменение Email заявителя.
   */
  const optimisticEditEmail = useCallback(async (req, newEmail, onError) => {
    const prevRequests = requests;
    setRequests(prev =>
      prev.map(r =>
        r.ID === req.ID
          ? { ...r, email: newEmail }
          : r
      )
    );

    try {
      const res = await authFetch('/api/requests/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.ID, newEmail }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setRequests(prevRequests);
      onError?.(e.message || 'Ошибка изменения заявителя');
    }
  }, [requests]);

  /**
   * Оптимистическое переключение статуса isPzAccepted.
   * 1. Сразу меняем цвет плашки в UI
   * 2. Отправляем запрос
   * 3. Если ошибка — откатываем
   */
  const optimisticTogglePzAccepted = useCallback(async (req, onError) => {
    const prevRequests = requests;
    const currentStatus = req.isPzAccepted === 'yes';
    // Optimistic update - инвертируем статус
    setRequests(prev =>
      prev.map(r =>
        r.ID === req.ID
          ? { ...r, isPzAccepted: currentStatus ? 'no' : 'yes' }
          : r
      )
    );

    try {
      const res = await authFetch('/api/requests/toggle-pz-accepted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.ID }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Синхронизируем с реальным статусом с сервера
      setRequests(prev =>
        prev.map(r =>
          r.ID === req.ID
            ? { ...r, isPzAccepted: data.isPzAccepted || (currentStatus ? 'no' : 'yes') }
            : r
        )
      );
    } catch (e) {
      setRequests(prevRequests);
      onError?.(e.message || 'Ошибка подтверждения ПЗ');
    }
  }, [requests]);

  /**
   * Оптимистическое переключение статуса isPbAccepted.
   * 1. Сразу меняем цвет плашки в UI
   * 2. Отправляем запрос
   * 3. Если ошибка — откатываем
   */
  const optimisticTogglePbAccepted = useCallback(async (req, onError) => {
    const prevRequests = requests;
    const currentStatus = req.isPbAccepted === 'yes';
    // Optimistic update - инвертируем статус
    setRequests(prev =>
      prev.map(r =>
        r.ID === req.ID
          ? { ...r, isPbAccepted: currentStatus ? 'no' : 'yes' }
          : r
      )
    );

    try {
      const res = await authFetch('/api/requests/toggle-pb-accepted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.ID }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Синхронизируем с реальным статусом с сервера
      setRequests(prev =>
        prev.map(r =>
          r.ID === req.ID
            ? { ...r, isPbAccepted: data.isPbAccepted || (currentStatus ? 'no' : 'yes') }
            : r
        )
      );
    } catch (e) {
      setRequests(prevRequests);
      onError?.(e.message || 'Ошибка подтверждения ПБ');
    }
  }, [requests]);

  return {
    requests,
    loading,
    error,
    load,
    reload,
    optimisticDelete,
    optimisticEditFio,
    optimisticEditEmail,
    optimisticTogglePzAccepted,
    optimisticTogglePbAccepted,
  };
}
