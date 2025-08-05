/**
 * @file FileSystemManager.js
 * @description 使用 File System Access API 管理本地文件（实验性功能）
 * @module core/export-import/FileSystemManager
 */

import { Logger } from '../../utils/Logger.js';

/**
 * 文件系统管理器
 * 使用 File System Access API 访问本地文件系统
 * 注意：这是实验性功能，需要用户授权
 */
export class FileSystemManager {
  constructor() {
    this.logger = new Logger('FileSystemManager');
    this.directoryHandle = null;
  }

  /**
   * 检查浏览器是否支持 File System Access API
   * @returns {boolean} 是否支持
   */
  isSupported() {
    return 'showDirectoryPicker' in window;
  }

  /**
   * 请求用户选择一个目录
   * @returns {Promise<FileSystemDirectoryHandle>} 目录句柄
   */
  async selectDirectory() {
    if (!this.isSupported()) {
      throw new Error('您的浏览器不支持 File System Access API');
    }

    try {
      this.directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      this.logger.log('Directory selected:', this.directoryHandle.name);
      return this.directoryHandle;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.log('User cancelled directory selection');
      } else {
        this.logger.error('Failed to select directory:', error);
      }
      throw error;
    }
  }

  /**
   * 在选定的目录中创建向量数据文件
   * @param {string} filename - 文件名
   * @param {Object} data - 要保存的数据
   */
  async saveVectorFile(filename, data) {
    if (!this.directoryHandle) {
      throw new Error('请先选择一个目录');
    }

    try {
      // 创建文件
      const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      
      // 写入数据
      const json = JSON.stringify(data, null, 2);
      await writable.write(json);
      await writable.close();
      
      this.logger.log(`Saved file: ${filename}`);
    } catch (error) {
      this.logger.error('Failed to save file:', error);
      throw error;
    }
  }

  /**
   * 读取向量数据文件
   * @param {string} filename - 文件名
   * @returns {Promise<Object>} 文件数据
   */
  async readVectorFile(filename) {
    if (!this.directoryHandle) {
      throw new Error('请先选择一个目录');
    }

    try {
      const fileHandle = await this.directoryHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'NotFoundError') {
        this.logger.log(`File not found: ${filename}`);
        return null;
      }
      this.logger.error('Failed to read file:', error);
      throw error;
    }
  }

  /**
   * 列出目录中的所有向量文件
   * @returns {Promise<Array>} 文件列表
   */
  async listVectorFiles() {
    if (!this.directoryHandle) {
      throw new Error('请先选择一个目录');
    }

    const files = [];
    try {
      for await (const entry of this.directoryHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          files.push({
            name: entry.name,
            handle: entry
          });
        }
      }
      return files;
    } catch (error) {
      this.logger.error('Failed to list files:', error);
      throw error;
    }
  }

  /**
   * 删除向量文件
   * @param {string} filename - 文件名
   */
  async deleteVectorFile(filename) {
    if (!this.directoryHandle) {
      throw new Error('请先选择一个目录');
    }

    try {
      await this.directoryHandle.removeEntry(filename);
      this.logger.log(`Deleted file: ${filename}`);
    } catch (error) {
      this.logger.error('Failed to delete file:', error);
      throw error;
    }
  }

  /**
   * 创建向量数据子目录
   * @param {string} name - 子目录名
   * @returns {Promise<FileSystemDirectoryHandle>} 子目录句柄
   */
  async createSubdirectory(name) {
    if (!this.directoryHandle) {
      throw new Error('请先选择一个目录');
    }

    try {
      const subDir = await this.directoryHandle.getDirectoryHandle(name, { create: true });
      this.logger.log(`Created subdirectory: ${name}`);
      return subDir;
    } catch (error) {
      this.logger.error('Failed to create subdirectory:', error);
      throw error;
    }
  }
}