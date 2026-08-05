@echo off
setlocal
title ArcFess 一键环境配置
chcp 65001 >nul

echo ===================================================
echo     ArcFess 自动安装程序 (包含 Python 与依赖)
echo ===================================================
echo.

:: 强制重置常用环境变量，防止由于用户电脑 PATH 损坏导致找不到基础命令
set "PATH=%SystemRoot%\system32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0\;%PATH%"

:: 尝试使用 py 启动器查找 (官方推荐方式，能避开微软商店拦截)
py -3 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 检测到已安装 Python 环境：
    py -3 --version
    set "PY_CMD=py -3"
    goto :InstallDeps
)

:: 后备：检测 python
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 检测到已安装 Python：
    python --version
    set "PY_CMD=python"
    goto :InstallDeps
)

echo [提示] 您的电脑尚未安装 Python，开始自动下载 Python 3.10...
echo 这可能需要几分钟的时间，请耐心等待。

:: 使用完整的 PowerShell 路径下载 Python
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe' -OutFile 'python-installer.exe'"

if not exist "python-installer.exe" (
    echo [错误] 下载 Python 失败，可能是网络问题或者您的系统不支持 PowerShell 下载。
    echo 解决办法：请手动前往 python.org 下载并安装 Python 3.10！
    pause
    exit /b
)

echo [提示] 下载完成，正在进行静默安装...
:: 启动静默安装
start /wait python-installer.exe /quiet InstallAllUsers=0 PrependPath=1 Include_test=0

echo [提示] Python 安装完成，正在清理安装包...
del python-installer.exe

:: 设置刚装好的 Python 绝对路径
set "LOCAL_PYTHON=%LocalAppData%\Programs\Python\Python310\python.exe"

if exist "%LOCAL_PYTHON%" (
    set "PY_CMD="%LOCAL_PYTHON%""
    echo [OK] 找到刚刚安装的 Python！
) else (
    echo [错误] 无法找到刚安装的 Python。
    echo 建议您手动重新安装一下 Python 并在安装时勾选 "Add Python to PATH"。
    pause
    exit /b
)

:InstallDeps
echo.
echo ===================================================
echo 正在配置 pip 镜像源并安装所需依赖...
echo (由于需要下载 PyTorch 等大文件，可能需要一段时间)
echo ===================================================

%PY_CMD% -m pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
%PY_CMD% -m pip install flask numpy requests waitress faiss-cpu hanlp torch -i https://pypi.tuna.tsinghua.edu.cn/simple

echo.
echo ===================================================
echo      全部配置完成！准备启动 ArcFess 服务...
echo ===================================================
pause

cd /d "%~dp0"
if exist vector_server.py (
    %PY_CMD% vector_server.py
) else (
    echo [错误] 找不到 vector_server.py，请确保本脚本放在 ArcFess 根目录。
)
pause
