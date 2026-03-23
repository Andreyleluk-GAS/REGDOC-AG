const API_HINT =
  'Запустите API: в корне проекта выполните «npm run dev:all» или в двух терминалах «npm run api» (порт 8787) и «npm run dev».';

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
    const err = new Error(data.error || `Ошибка ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
