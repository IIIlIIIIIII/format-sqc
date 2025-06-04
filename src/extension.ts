import * as vscode from 'vscode';
import { TextDocument } from 'vscode';
import { format } from 'sql-formatter';

export function activate(context: vscode.ExtensionContext) {
    // 1. 注册自定义格式化提供器
    const formatter = vscode.languages.registerDocumentFormattingEditProvider('sqc', {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
            // 这里只执行内置格式化
            // 实际格式化由后续的自定义命令完成
            return [];
        }
    });

    // 2. 注册自定义格式化命令
    const formatCommand = vscode.commands.registerCommand('format-sqc.formatsqc', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        try {
            // 第一步：执行内置格式化命令
            await vscode.commands.executeCommand('editor.action.formatDocument');

            // 第二步：执行自定义SQC格式化
            const formattedText = formatSQCCode(editor.document.getText());
            await editor.edit(editBuilder => {
                editBuilder.replace(
                    new vscode.Range(
                        new vscode.Position(0, 0),
                        editor.document.positionAt(editor.document.getText().length)
                    ),
                    formattedText
                );
            });
            vscode.window.showInformationMessage('SQC格式化完成');
        } catch (error) {
            vscode.window.showErrorMessage(`格式化失败: ${error}`);
        }
    });

    context.subscriptions.push(formatter, formatCommand);
}

// 辅助函数：获取整个文档范围
function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLine = document.lineCount - 1;
    return new vscode.Range(
        0, 0,
        lastLine, document.lineAt(lastLine).text.length
    );
}
function formatSQCCode(text: string): string { // 只格式化SQL部分
    const lines = text.split('\n');
    let formattedLines: string[] = []; // 返回数据
    let indentLevel = 0;
    let inSQLBlock = false;
    const sqlIndent = indentLevel + 1;  // SQL 块固定缩进级别
    let SQLstr = '';

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let leadingSpaces = Math.ceil(countLeadingSpaces(line) / 4) * 4;
        let tmpline = line.replace(/\t/g, '    ').trim();
        // 处理 SQL 块开始/结束
        if (tmpline.startsWith("EXEC SQL") && tmpline.length === 8) {
            inSQLBlock = true;
            SQLstr += line + ' ';
            continue;
        } else if (inSQLBlock && tmpline.includes(';')) {
            inSQLBlock = false;
            SQLstr += line + ' ';
            const formattedSQL = formatSQLString(SQLstr, leadingSpaces);
            formattedLines.push(formattedSQL);
            SQLstr = '';
            continue;
        }
        // SQL 块格式化（核心改进）
        if (inSQLBlock && tmpline.includes(';')) { // 防止重复
            continue;
        } else if (inSQLBlock) {
            SQLstr += tmpline + ' ';
            continue;
        } else {
            formattedLines.push(line);
        }
    }
    console.log(SQLstr); // 普通日志
    return formattedLines.join('\n');
}

function countLeadingSpaces(line: string): number {
    let count = 0;
    for (const char of line) {
        if (char === ' ') count++;
        else break; // 遇到非空格字符时停止
    }
    return count;
}
/**
 * 格式化 SQL 字符串：
 * 1. 去掉冒号后的空格（`: name` → `:name`）。
 * 2. 合并连续多个空格为单个空格。
 * 3. 自动处理换行和缩进（基于 SQL 关键字）。
 */
/**
 * 格式化 SQL 字符串：
 * 1. 去掉冒号后的空格（`: name` → `:name`）。
 * 2. 合并连续多个空格为单个空格。
 * 3. 自动处理换行和缩进（基于 SQL 关键字）。
 * 4. 支持基础缩进对齐（通过 `baseIndent` 参数）。
 */
function formatSQLString(
    sql: string,
    baseIndent: number = 0, // 默认不额外缩进
    indentSize: number = 4  // 默认缩进 4 空格
): string {
    // 1. 去掉冒号后的空格
    let formatted = sql.replace(/:\s+/g, ':');

    // 2. 合并连续多个空格
    formatted = formatted.replace(/\s+/g, ' ').trim();

    // 3. 自动换行和缩进（基于 SQL 关键字）
    const keywords = ['EXEC SQL', 'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'GROUP BY', 'ORDER BY', 'UPDATE', 'SET', 'INSERT INTO', 'INTO', 'VALUES'];
    let indentLevel = 0;
    let result = '';

    // 按空格拆分单词
    const words = formatted.split(' ');
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const nextWord = words[i + 1];

        // 处理缩进（遇到关键字换行并缩进）
        if (keywords.includes(word.toUpperCase())) {
            if (word.toUpperCase() === 'AND' || word.toUpperCase() === 'OR') {
                indentLevel--; // 回退一级缩进
            }
            // 添加基础缩进 + 当前缩进级别
            result += `\n${' '.repeat(baseIndent + indentLevel * indentSize)}${word}`;
            if (word.toUpperCase() === 'SELECT' || word.toUpperCase() === 'FROM' || word.toUpperCase() === 'WHERE') {
                indentLevel++; // 增加缩进级别
            }
        } else {
            result += ` ${word}`;
        }

        // 处理逗号换行
        if (word.endsWith(',') && nextWord && !keywords.includes(nextWord.toUpperCase())) {
            result += `\n${' '.repeat(baseIndent + indentLevel * indentSize)}`;
        }
    }

    return result.trim();
}