export class ConfigManager {
  constructor(extensionSettings, saveFunction) {
    this.extensionSettings = extensionSettings;
    this.saveFunction = saveFunction;
  }

  get(key) {
    // 从 extension_settings.vectors_enhanced 中读取
    return this.extensionSettings.vectors_enhanced?.[key];
  }

  set(key, value) {
    // 确保 vectors_enhanced 对象存在
    if (!this.extensionSettings.vectors_enhanced) {
      this.extensionSettings.vectors_enhanced = {};
    }

    // 设置值
    this.extensionSettings.vectors_enhanced[key] = value;

    // 保存设置
    this.saveFunction();

    return value;
  }

  getAll() {
    // 返回所有设置
    return this.extensionSettings.vectors_enhanced || {};
  }
}
