import * as vscode from 'vscode';
import { format } from 'sql-formatter';

export function activate(context: vscode.ExtensionContext) {
    const formatCommand = vscode.commands.registerCommand('format-sqc.formatsqc', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return;}

        try {
            let selection = editor.selection;

            const sqlRange = findCurrentSQLBlock(editor.document, editor.selection.active);
            if (sqlRange) {
                editor.selection = new vscode.Selection(sqlRange.start, sqlRange.end);
                selection = editor.selection;
            } else {
                vscode.window.showWarningMessage('未找到有效的 SQL 块');
                return;
            }

            const selectedText = editor.document.getText(selection);
            const baseIndent = getBaseIndent(selectedText);
            const formattedText = formatSQLString(selectedText, baseIndent);

            await editor.edit(editBuilder => {
                editBuilder.replace(selection, formattedText);
            });

            vscode.window.showInformationMessage('SQC 格式化完成');
        } catch (error) {
            vscode.window.showErrorMessage(`格式化失败: ${error}`);
        }
    });

    context.subscriptions.push(formatCommand);
}
function countLeadingSpaces(line: string): number {
    // 将 tab 视作 4 个空格
    return line.replace(/\t/g, '    ').match(/^ */)?.[0].length ?? 0;
}

function getBaseIndent(text: string): number {
    const firstLine = text.split('\n')[0];
    const rawIndent = countLeadingSpaces(firstLine);
    return Math.floor(rawIndent / 4) * 4; // 向下取整为 4 的倍数
}
function findCurrentSQLBlock(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);

    let startPos = -1;
    let indentSpaces = 0;
    let inComment = false;
    let inBlockComment = false;

    // 向前查找 EXEC SQL
    for (let i = offset; i >= 0; i--) {
        const char = text[i];

        // 行注释
        if (!inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '--') {
            inComment = true;
        }
        if (inComment && char === '\n') {
            inComment = false;
        }

        // 块注释
        if (!inComment && i > 0 && text.substring(i - 1, i + 1) === '*/') {
            inBlockComment = true;
        }
        if (inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '/*') {
            inBlockComment = false;
            i--;
            continue;
        }

        // 匹配 EXEC SQL
        if (!inComment && !inBlockComment && i >= 7 && text.substring(i - 7, i + 1).toUpperCase() === 'EXEC SQL') {
            let lineStart = i - 7;
            let spaceCount = 0;
            while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
                spaceCount += (text[lineStart - 1] === '\t') ? 4 : 1;
                lineStart--;
            }
            indentSpaces = Math.floor(spaceCount / 4) * 4;
            startPos = lineStart;
            break;
        }
    }

    if (startPos === -1) {
        return;
    }

    // 向后查找第一个分号（语句结束）
    let endPos = -1;
    inComment = false;
    inBlockComment = false;
    for (let i = startPos; i < text.length; i++) {
        const char = text[i];

        // 行注释
        if (!inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '--') {
            inComment = true;
        }
        if (inComment && char === '\n') {
            inComment = false;
        }

        // 块注释
        if (!inComment && i > 0 && text.substring(i - 1, i + 1) === '/*') {
            inBlockComment = true;
        }
        if (inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '*/') {
            inBlockComment = false;
            i++;
            continue;
        }

        if (!inComment && !inBlockComment && char === ';') {
            endPos = i + 1;
            break;
        }
    }

    if (endPos === -1) {
        return;
    }

    const start = document.positionAt(startPos);
    const end = document.positionAt(endPos);

    return new vscode.Range(start, end);
}


// 使用 sql-formatter 格式化 SQC
function formatSQLString(sql: string, baseIndent: number = 0, indentSize: number = 4): string {
    const indentUnit = ' '.repeat(indentSize);
    const execIndent = ' '.repeat(baseIndent);
    const sqlIndent = execIndent + indentUnit;

    // 去掉 EXEC SQL 和末尾分号
    let sqlBody = sql.replace(/^\s*EXEC\s+SQL\s+/i, '').replace(/;\s*$/, '').trim();

    // 替换嵌入变量冒号后空格
    sqlBody = sqlBody.replace(/:\s+/g, ':');

    // 使用 sql-formatter 格式化
    let formatted = format(sqlBody, {
        language: 'db2',
        keywordCase: 'upper',
        tabWidth: indentSize
    });

    // 给每一行加缩进（比 EXEC SQL 多一级）
    const formattedLines = formatted.split('\n').map(line => sqlIndent + line);

    // 拼接最终结果
    return `${execIndent}EXEC SQL\n${formattedLines.join('\n')}\n${execIndent};`;
}
