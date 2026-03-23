const API_HINT =
  'Остановите процесс и запустите из корня проекта команду «npm run dev» — она поднимает и сайт, и API (порт 8787). Либо в двух терминалах: «npm run api» и «npm run dev:vite».';

export async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Нет связи с сервером. ${API_HINT}`);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(res.status === 502 || res.status === 504 ? `Прокси не достучался до API. ${API_HINT}` : 'Некорректный ответ сервера');
    }
  }

  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`Сервер API недоступен (код ${res.status}). ${API_HINT}`);
    }
    const err = new Error(data.error || `Ошибка ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
