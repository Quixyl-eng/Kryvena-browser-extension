(function () {
  var ids = ['provider', 'apiKey', 'endpoint', 'model', 'showFab'];
  var defaults = { provider: 'openai', apiKey: '', model: '', endpoint: '', showFab: true };
  var lastTouch = 0;
  var modelTimer = null;
  function byId(id) { return document.getElementById(id); }
  function toggleEndpoint() { byId('endpointWrap').style.display = byId('provider').value === 'custom' ? 'block' : 'none'; }
  function showMessage(value, error) { byId('message').textContent = value; byId('message').style.color = error ? '#ff453a' : ''; }
  function showModelStatus(value, error) { byId('modelStatus').textContent = value; byId('modelStatus').style.color = error ? '#ff453a' : ''; }
  function formSettings() { var settings = {}; ids.forEach(function (id) { var el = byId(id); settings[id] = el.type === 'checkbox' ? el.checked : String(el.value || '').trim(); }); settings.apiKey = settings.apiKey.replace(/^[`'\"]+|[`'\"]+$/g, '').trim(); return settings; }
  function load(settings) { settings = Object.assign({}, defaults, settings || {}); ids.forEach(function (id) { var el = byId(id); if (el.type === 'checkbox') el.checked = Boolean(settings[id]); else if (id !== 'model') el.value = settings[id] == null ? '' : settings[id]; }); toggleEndpoint(); setModelOptions([], settings.model); }
  function setModelOptions(models, selected) { var select = byId('model'); select.innerHTML = ''; if (selected && models.indexOf(selected) < 0) models.unshift(selected); if (!models.length) { select.innerHTML = '<option value="">Введите ключ и обновите список</option>'; return; } models.forEach(function (model) { var option = document.createElement('option'); option.value = model; option.textContent = model; if (model === selected) option.selected = true; select.appendChild(option); }); }
  function loadModels() { var settings = formSettings(); if (!settings.apiKey) { showModelStatus('Сначала вставьте API-ключ.', true); return; } showModelStatus('Получаю доступные модели…'); byId('loadModels').disabled = true; chrome.runtime.sendMessage({ type: 'listModels', settings: { provider: settings.provider, apiKey: settings.apiKey, endpoint: settings.endpoint } }, function (result) { byId('loadModels').disabled = false; if (chrome.runtime.lastError || !result || result.error) { showModelStatus(result && result.error || 'Не удалось получить список моделей.', true); return; } setModelOptions(result.models || [], settings.model); showModelStatus('Найдено моделей: ' + (result.models || []).length); }); }
  function testConnection() { var settings = formSettings(); if (!settings.apiKey) { showMessage('Сначала вставьте API-ключ.', true); return; } if (!settings.model) { showMessage('Сначала выберите модель.', true); return; } showMessage('Проверяю соединение…'); byId('testConnection').disabled = true; chrome.runtime.sendMessage({ type: 'testConnection', settings: settings }, function (result) { byId('testConnection').disabled = false; if (chrome.runtime.lastError || !result || !result.ok) { showMessage(result && result.error || 'Не удалось связаться с провайдером.', true); return; } showMessage('Соединение работает.'); }); }
  function save() { var settings = formSettings(); if (!settings.model) { showMessage('Сначала выберите модель.', true); return; } chrome.runtime.sendMessage({ type: 'saveSettings', settings: settings }, function (result) { if (chrome.runtime.lastError || !result || !result.ok) showMessage('Не удалось сохранить', true); else showMessage('Настройки сохранены'); }); }
  function bindAction(element, handler) { element.addEventListener('touchend', function (event) { event.preventDefault(); lastTouch = Date.now(); handler(); }, { passive: false }); element.addEventListener('click', function () { if (Date.now() - lastTouch > 500) handler(); }); }
  chrome.runtime.sendMessage({ type: 'getSettings' }, function (settings) { if (chrome.runtime.lastError) { showMessage('Не удалось загрузить настройки', true); return; } load(settings); if (settings && settings.apiKey) loadModels(); });
  byId('provider').addEventListener('change', function () { toggleEndpoint(); setModelOptions([], ''); if (byId('apiKey').value) loadModels(); });
  byId('apiKey').addEventListener('change', function () { clearTimeout(modelTimer); modelTimer = setTimeout(loadModels, 300); });
  byId('endpoint').addEventListener('change', function () { if (byId('apiKey').value && byId('provider').value === 'custom') loadModels(); });
  bindAction(byId('loadModels'), loadModels);
  bindAction(byId('testConnection'), testConnection);
  bindAction(byId('save'), save);
}());
