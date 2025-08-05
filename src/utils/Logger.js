export class Logger {
  constructor(module) {
    this.module = module;
  }
  log(message, ...args) {
    console.log(`[${this.module}] ${message}`, ...args);
  }
  error(message, ...args) {
    console.error(`[${this.module}] ${message}`, ...args);
  }
  warn(message, ...args) {
    console.warn(`[${this.module}] ${message}`, ...args);
  }
  debug(message, ...args) {
    console.debug(`[${this.module}] ${message}`, ...args);
  }
}
