(function () {
  var defaults = { provider: 'openai', apiKey: '', model: '', endpoint: '', showFab: true };
  var providers = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-latest' },
    gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models/', model: 'gemini-2.0-flash' },
    deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' }
  };

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(defaults, function (value) {
        if (chrome.runtime.lastError) { resolve(normalizeSettings(defaults)); return; }
        resolve(normalizeSettings(Object.assign({}, defaults, value || {})));
      });
    });
  }

  function extractText(data) {
    if (data && data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content || '';
    if (data && data.content && data.content[0]) return data.content[0].text || '';
    if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) return data.candidates[0].content.parts.map(function (part) { return part.text || ''; }).join('');
    return '';
  }

  function trimEndpoint(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function cleanApiKey(value) {
    return String(value || '').trim().replace(/^[`'\"]+|[`'\"]+$/g, '').trim();
  }

  function normalizeSettings(value) {
    var settings = Object.assign({}, defaults, value || {});
    settings.provider = String(settings.provider || 'openai').trim().toLowerCase();
    settings.apiKey = cleanApiKey(settings.apiKey);
    settings.model = String(settings.model || '').trim();
    settings.endpoint = trimEndpoint(settings.endpoint);
    return settings;
  }

  function normalizeChatEndpoint(value) {
    var url = trimEndpoint(value);
    if (/\/v1$/i.test(url)) return url + '/chat/completions';
    return url;
  }

  function normalizeModelsEndpoint(value) {
    var url = trimEndpoint(value);
    if (/\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, '/models');
    if (/\/v1$/i.test(url)) return url + '/models';
    return url;
  }

  function providerError(status, raw, apiKey) {
    var data;
    try { data = JSON.parse(raw); } catch (error) { data = null; }
    var detail = '';
    if (data && data.error) {
      detail = typeof data.error === 'string' ? data.error : data.error.message || data.error.detail || data.error.code || '';
    }
    if (!detail && data) detail = data.message || data.detail || data.code || '';
    if (!detail && raw && raw.length <= 300 && !/^\s*</.test(raw)) detail = raw.trim();
    if (apiKey && detail) detail = detail.split(apiKey).join('[ключ скрыт]');
    detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    var message = status === 401 || status === 403
      ? 'Провайдер отклонил доступ (HTTP ' + status + ').'
      : 'Провайдер вернул HTTP ' + status + '.';
    return message + (detail ? ' ' + detail : ' Проверьте API-ключ, endpoint и модель.');
  }

  function fetchProvider(url, options) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error('timeout')); }, 30000);
    });
    return Promise.race([fetch(url, options), timeout]).then(function (response) {
      clearTimeout(timer);
      return response;
    }, function (error) {
      clearTimeout(timer);
      var reason = error && error.message === 'timeout' ? 'Превышено время ожидания ответа.' : 'Сетевой запрос не выполнен (проверьте интернет, endpoint и разрешение API).';
      throw new Error(reason);
    });
  }

  function requestAnswer(prompt, inputSettings) {
    var settingsPromise = inputSettings ? Promise.resolve(normalizeSettings(inputSettings)) : getSettings();
    return settingsPromise.then(function (settings) {
      var provider = providers[settings.provider];
      var url = settings.provider === 'custom' ? normalizeChatEndpoint(settings.endpoint) : provider && provider.url;
      var model = settings.model || (provider && provider.model);
      if (!settings.apiKey || !url || !model) throw new Error('Проверьте провайдера, endpoint, модель и API-ключ.');
      if (settings.provider === 'gemini') url += model + ':generateContent';
      try { if (new URL(url).protocol !== 'http:' && new URL(url).protocol !== 'https:') throw new Error('Endpoint должен начинаться с http:// или https://.'); } catch (error) { throw new Error('Некорректный URL endpoint.'); }
      var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey };
      var body = { model: model, messages: [{ role: 'system', content: 'Выбери правильный вариант ответа. Верни только точный текст варианта, без пояснений.' }, { role: 'user', content: prompt }] };
      if (settings.provider === 'gemini') {
        headers = { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey };
        body = { contents: [{ parts: [{ text: 'Выбери правильный вариант ответа. Верни только точный текст варианта, без пояснений.\n\n' + prompt }] }] };
      }
      if (settings.provider === 'anthropic') {
        headers = { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
        body = { model: model, max_tokens: 256, messages: [{ role: 'user', content: 'Выбери правильный вариант ответа. Верни только точный текст варианта, без пояснений.\n\n' + prompt }] };
      }
      return fetchProvider(url, { method: 'POST', headers: headers, body: JSON.stringify(body) }).then(function (response) {
        return response.text().then(function (raw) {
          var data; try { data = JSON.parse(raw); } catch (error) { data = null; }
          if (!response.ok) throw new Error(providerError(response.status, raw, settings.apiKey));
          var answer = extractText(data).trim();
          if (!answer) throw new Error('Провайдер не вернул текст ответа.');
          return answer;
        });
      });
    });
  }

  function modelListSettings(input) {
    return getSettings().then(function (saved) { return normalizeSettings(Object.assign({}, saved, input || {})); });
  }

  function modelListRequest(settings) {
    var provider = providers[settings.provider];
    var url = settings.provider === 'custom' ? normalizeModelsEndpoint(settings.endpoint) : provider && provider.url;
    if (settings.provider === 'gemini') url = 'https://generativelanguage.googleapis.com/v1beta/models';
    else if (settings.provider === 'anthropic') url = 'https://api.anthropic.com/v1/models';
    else if (settings.provider === 'openai') url = 'https://api.openai.com/v1/models';
    else if (settings.provider === 'deepseek') url = 'https://api.deepseek.com/models';
    else if (url) url = url.replace(/\/chat\/completions\/?$/, '/models');
    if (!settings.apiKey || !url) throw new Error('Введите API-ключ и endpoint.');
    var headers = { 'Authorization': 'Bearer ' + settings.apiKey };
    if (settings.provider === 'gemini') headers = { 'x-goog-api-key': settings.apiKey };
    if (settings.provider === 'anthropic') headers = { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
    return fetchProvider(url, { method: 'GET', headers: headers }).then(function (response) {
      return response.text().then(function (raw) {
        var data; try { data = JSON.parse(raw); } catch (error) { data = null; }
        if (!response.ok) throw new Error('Список моделей: ' + providerError(response.status, raw, settings.apiKey));
        var models = [];
        if (data && Array.isArray(data.data)) models = data.data.map(function (item) { return item.id; });
        if (data && Array.isArray(data.models)) models = data.models.map(function (item) { return String(item.name || '').replace(/^models\//, ''); });
        models = models.filter(function (id) { return id && !/embedding|moderation|image|audio|tts|whisper/i.test(id); }).sort();
        if (!models.length) throw new Error('Провайдер не вернул доступные модели.');
        return models;
      });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'getSettings') { getSettings().then(sendResponse); return true; }
    if (message.type === 'saveSettings') {
      chrome.storage.local.set(normalizeSettings(message.settings), function () { sendResponse({ ok: !chrome.runtime.lastError }); });
      return true;
    }
    if (message.type === 'testConnection') {
      requestAnswer('Ответь одним словом: OK.', message.settings).then(function () { sendResponse({ ok: true }); }).catch(function (error) { sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === 'ask' || message.action === 'llmQuery') {
      requestAnswer(message.prompt || '').then(function (answer) { sendResponse(message.action === 'llmQuery' ? { success: true, answer: answer } : { answer: answer }); }).catch(function (error) { sendResponse(message.action === 'llmQuery' ? { success: false, error: error.message } : { error: error.message }); });
      return true;
    }
    if (message.type === 'listModels') {
      modelListSettings(message.settings).then(modelListRequest).then(function (models) { sendResponse({ models: models }); }).catch(function (error) { sendResponse({ error: error.message }); });
      return true;
    }
    return false;
  });
}());
