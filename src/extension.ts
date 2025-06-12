import * as vscode from 'vscode';
import { format } from 'sql-formatter';

export function activate(context: vscode.ExtensionContext) {
    // 命令1：格式化当前光标所在的 EXEC SQL 块
    const formatSingleSQLCommand = vscode.commands.registerCommand('format-sqc.formatsqc', async () => {
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
            vscode.window.showInformationMessage('SQL 块格式化完成');
        } catch (error) {
            vscode.window.showErrorMessage(`格式化SQL失败: ${error}`);
        }
    });

    // 命令2：全文格式化，SQL分块单独格式化，C代码用VSCode内置格式化
    const formatWholeCommand = vscode.commands.registerCommand('format-sqc.formatDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return;}

        try {
            await formatWholeWithSQLSeparately(editor);
            vscode.window.showInformationMessage('全文 SQC 格式化完成（SQL分块单独格式化）');
        } catch (error) {
            vscode.window.showErrorMessage(`格式化全文失败: ${(error as Error).message}`);
        }
    });

    context.subscriptions.push(formatSingleSQLCommand, formatWholeCommand);
}

function findCurrentSQLBlock(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);

    let startPos = -1;
    let inComment = false;
    let inBlockComment = false;
    let inString = false;
    let stringChar = '';

    // 向前查找 EXEC SQL 关键字，跳过注释和字符串
    for (let i = offset; i >= 0; i--) {
        const char = text[i];
        const prevChar = text[i - 1];

        // 字符串开始/结束
        if (!inComment && !inBlockComment) {
            if (!inString && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
            }
        }
        if (inString) {continue;}

        // 行注释
        if (!inBlockComment && i > 0 && text.substring(i - 2, i) === '--') {
            inComment = true;
        }
        if (inComment && char === '\n') {
            inComment = false;
        }

        // 块注释开始/结束
        if (!inComment && i > 0 && text.substring(i - 1, i + 1) === '*/') {
            inBlockComment = true;
        }
        if (inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '/*') {
            inBlockComment = false;
            i--;
            continue;
        }

        // 找到 EXEC SQL，忽略大小写
        if (!inComment && !inBlockComment && !inString && i >= 7 && text.substring(i - 7, i + 1).toUpperCase() === 'EXEC SQL') {
            // 找到 EXEC SQL 起始位置
            let lineStart = i - 7;
            // 向前跳过空白字符，计算缩进
            while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
                lineStart--;
            }
            startPos = lineStart;
            break;
        }
    }

    if (startPos === -1) {return undefined;}

    // 向后查找 SQL 结束分号，跳过注释和字符串
    let endPos = -1;
    inComment = false;
    inBlockComment = false;
    inString = false;
    stringChar = '';

    for (let i = startPos; i < text.length; i++) {
        const char = text[i];
        const prevChar = text[i - 1];

        // 字符串开始/结束
        if (!inComment && !inBlockComment) {
            if (!inString && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
            }
        }
        if (inString) {continue;}

        // 行注释
        if (!inBlockComment && i > 0 && text.substring(i - 2, i) === '--') {
            inComment = true;
        }
        if (inComment && char === '\n') {
            inComment = false;
        }

        // 块注释开始/结束
        if (!inComment && i > 0 && text.substring(i - 1, i + 1) === '/*') {
            inBlockComment = true;
        }
        if (inBlockComment && i > 0 && text.substring(i - 1, i + 1) === '*/') {
            inBlockComment = false;
            i++;
            continue;
        }

        // 找到分号结束符
        if (!inComment && !inBlockComment && !inString && char === ';') {
            endPos = i + 1;
            break;
        }
    }

    if (endPos === -1) {return undefined;}

    return new vscode.Range(document.positionAt(startPos), document.positionAt(endPos));
}

async function formatWholeWithSQLSeparately(editor: vscode.TextEditor): Promise<void> {
    const doc = editor.document;
    const text = doc.getText();

    // 1. 提取所有SQL块
    const sqlBlocks = extractSQLBlocks(text);

    // 2. 用占位符替换SQL块，记录替换后的文本
    let placeholderText = '';
    let lastIndex = 0;
    const placeholders: { placeholder: string; formattedSQL?: string }[] = [];

    for (let i = 0; i < sqlBlocks.length; i++) {
        const block = sqlBlocks[i];
        placeholderText += text.substring(lastIndex, block.start);
        const placeholder = `__SQL_BLOCK_${i}__`;
        placeholders.push({ placeholder });
        placeholderText += placeholder;
        lastIndex = block.end;
    }
    placeholderText += text.substring(lastIndex);

    // 3. 替换编辑器内容为占位符文本
    await editor.edit(editBuilder => {
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
        editBuilder.replace(fullRange, placeholderText);
    });

    // 4. 调用 VSCode 内置格式化命令格式化 C 代码（带占位符）
    await vscode.commands.executeCommand('editor.action.formatDocument');

    // 5. 格式化每个 SQL 块文本
    for (let i = 0; i < sqlBlocks.length; i++) {
        const block = sqlBlocks[i];
        const baseIndent = getBaseIndent(block.sql);
        const formattedSQL = formatSQLString(block.sql, baseIndent);
        placeholders[i].formattedSQL = formattedSQL.trimStart();
    }

    // 6. 把格式化后的 SQL 替换占位符
    let postFormatText = editor.document.getText();
    for (const ph of placeholders) {
        // 注意用正则替换所有匹配项
        const re = new RegExp(ph.placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
        postFormatText = postFormatText.replace(re, ph.formattedSQL ?? ph.placeholder);
    }

    // 7. 替换编辑器内容为最终文本
    await editor.edit(editBuilder => {
        const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
        );
        editBuilder.replace(fullRange, postFormatText);
    });

}

// 判断是C代码还是SQL代码
function extractSQLBlocks(text: string): { start: number; end: number; sql: string }[] {
    const blocks: { start: number; end: number; sql: string }[] = [];
    const regex = /^[ \t]*EXEC\s+SQL[\s\S]*?;/gim;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const sqlText = match[0];
        // 跳过包含 DECLARE SECTION 或 INCLUDE 的 SQL 块
        if (/DECLARE\s+SECTION/i.test(sqlText) || sqlText.includes('INCLUDE')) {
            continue;
        }
        blocks.push({
            start: match.index,
            end: match.index + sqlText.length,
            sql: sqlText
        });
    }
    return blocks;
}


function formatSQLString(sql: string, baseIndent: number = 0, indentSize: number = 4): string {
    const indentUnit = ' '.repeat(indentSize);
    const execIndent = ' '.repeat(baseIndent);
    const sqlIndent = execIndent + indentUnit;

    // 清理冒号后多余空格
    sql = sql.replace(/:\s+/g, ':');

    // 判断是否多行（是否包含换行符）
    if (sql.indexOf('\n') === -1) {
        // 只有一行，视为普通 C 代码，不作为 SQL 块处理
        return sql;
    }

    // 去掉 EXEC SQL 和末尾分号，trim空白
    let sqlBody = sql.replace(/^\s*EXEC\s+SQL\s+/i, '').replace(/;\s*$/, '').trim();

    // 使用 sql-formatter 格式化
    let formatted = format(sqlBody, {
        language: 'db2',
        keywordCase: 'upper',
        tabWidth: indentSize
    });

    // 给每行增加缩进
    const formattedLines = formatted.split('\n').map(line => sqlIndent + line);
    return `${execIndent}EXEC SQL\n${formattedLines.join('\n')}\n${execIndent};`;
}

function getBaseIndent(text: string): number {
    const firstLine = text.split('\n')[0];
    const rawIndent = countLeadingSpaces(firstLine);
    return Math.floor(rawIndent / 4) * 4;
}

function countLeadingSpaces(line: string): number {
    return line.replace(/\t/g, '    ').match(/^ */)?.[0].length ?? 0;
}
