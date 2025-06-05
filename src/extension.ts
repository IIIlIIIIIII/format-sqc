import * as vscode from 'vscode';
import { TextDocument } from 'vscode';
import { format, type FormatOptions } from 'sql-formatter';

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
        if (!editor) { return; }

        try {
            // 第1步：数据清洗
            let formattedText = dataClean(editor.document.getText());
            await editor.edit(editBuilder => {
                editBuilder.replace(
                    new vscode.Range(
                        new vscode.Position(0, 0),
                        editor.document.positionAt(editor.document.getText().length)
                    ),
                    formattedText
                );
            });
            // 第2步：执行内置格式化命令
            await vscode.commands.executeCommand('editor.action.formatDocument');

            // 第3步：执行自定义SQC格式化
            formattedText = formatSQCCode(editor.document.getText());
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
function dataClean(text: string): string { // 全文数据清洗
    const lines = text.split('\n');
    let formattedLines: string[] = []; // 返回数据
    let inSQLBlock = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let tmpline = line.replace(/\s+/g, ' '); // 合并多个空格
        tmpline = tmpline.replace(/\t/g, '    ').trim();
        // 处理 SQL 块开始/结束
        if ((tmpline.startsWith("EXEC SQL") && tmpline.length === 8) ||
            tmpline.startsWith("EXEC SQL DECLARE") ||
            tmpline.startsWith("EXEC SQL SELECT") ||
            tmpline.startsWith("EXEC SQL FETCH")) {
            if (!tmpline.includes(';')) {
                inSQLBlock = true;
                formattedLines.push(line.split('--')[0].trimEnd());
            } else if (tmpline.length === 1) {
                formattedLines.push('\n' + line);
            } else {
                formattedLines.push(line.split('--')[0].trimEnd());
                continue;
            }
            continue;
        } else if (inSQLBlock && tmpline.includes(';')) {
            inSQLBlock = false;
            formattedLines.push(line.split('--')[0].trimEnd());
            continue;
        }
        // SQL 块格式化（核心改进）
        if (inSQLBlock && tmpline.includes('--')) {
            // 如果包含 -- 注释，截取 -- 前的部分
            formattedLines.push(line.split('--')[0].trimEnd());
            continue;
        }
        else if (inSQLBlock && tmpline.includes(';')) { // 防止重复
            continue;
        } else if (inSQLBlock) {
            formattedLines.push(line);
            continue;
        } else {
            formattedLines.push(line);
        }
    }
    return formattedLines.join('\n');
}


function formatSQCCode(text: string): string { // 只格式化SQL部分
    const lines = text.split('\n');
    let formattedLines: string[] = []; // 返回数据
    let inSQLBlock = false;
    let SQLstr = '';
    let leadingSpaces = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let tmpline = line.replace(/\s+/g, ' '); // 合并多个空格
        tmpline = tmpline.replace(/\t/g, '    ').trim();
        // 处理 SQL 块开始/结束
        if ((tmpline.startsWith("EXEC SQL") && tmpline.length === 8) ||
            tmpline.startsWith("EXEC SQL DECLARE") ||
            tmpline.startsWith("EXEC SQL SELECT") ||
            tmpline.startsWith("EXEC SQL FETCH")) {
            leadingSpaces = Math.ceil(countIndentation(line) / 4) * 4;
            if (!tmpline.includes(';')) {
                inSQLBlock = true;
            } else if (tmpline.length === 1) {
                formattedLines.push('\n' + line);
            } else {
                let formattedSQL = '';
                if (tmpline.startsWith("EXEC SQL DECLARE")) {
                    SQLstr += line + ' ';
                }
                formattedSQL = formatSQLString(SQLstr, leadingSpaces);
                formattedLines.push(formattedSQL);
                SQLstr = '';
                leadingSpaces = 0;
                continue;
            }
            SQLstr += line + ' ';
            continue;
        } else if (inSQLBlock && tmpline.includes(';')) {
            inSQLBlock = false;
            SQLstr += line + ' ';
            SQLstr = SQLstr.replace(/:\s+/g, ':');
            SQLstr = SQLstr.replace(/\s+/g, ' ').trim();
            const formattedSQL = formatSQLString(SQLstr, leadingSpaces);
            formattedLines.push(formattedSQL);
            SQLstr = '';
            leadingSpaces = 0;
            continue;
        }
        // SQL 块格式化（核心改进）
        if (inSQLBlock && tmpline.includes('--')) {
            // 如果包含 -- 注释，截取 -- 前的部分
            tmpline = tmpline.split('--')[0].trim();  // 截取 -- 前的内容并去除多余空格
            SQLstr += tmpline + ' ';
            continue;
        }
        else if (inSQLBlock && tmpline.includes(';')) { // 防止重复
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

function countIndentation(line: string): number {
    let count = 0;
    for (const ch of line) {
        if (ch === ' ') {
            count += 1;
        } else if (ch === '\t') {
            count += 4; // 每个 tab 视为 4 个空格
        } else {
            break;
        }
    }
    return count;
}
/**
 * 格式化 SQL 字符串：
 * 1. 去掉冒号后的空格（`: name` → `:name`）。
 * 2. 合并连续多个空格为单个空格。
 * 3. 自动处理换行和缩进（基于 SQL 关键字）。
 * 4. 支持基础缩进对齐（通过 `baseIndent` 参数）。
 */
function formatSQLString(sql: string, baseIndent: number = 0, indentSize: number = 4): string {
    // 0. 保护注释内容
    let result = '';
    const commentBlocks: string[] = [];
    let formatted = sql.replace(/(--.*?$)/gm, (match) => {
        // 将注释替换为占位符
        commentBlocks.push(match);
        return ``;
    });
    try {
        // 1. 基础清理
        formatted = sql
            .replace(/:\s+/g, ':')  // 移除冒号后的空格
            .replace(/\s*=\s*/g, ' = ')  // 规范等号前后空格（保留各一个）
            .replace(/([^ ])([()])/g, '$1 $2')  // 左括号前加空格（如果前面不是空格）
            .replace(/([()])([^ ])/g, '$1 $2')  // 右括号后加空格（如果后面不是空格）
            .replace(/\s*,\s*/g, ' , ')  // 规范逗号前后空格（前后各一个）
            .replace(/\s+/g, ' ')   // 合并多个空格
            .trim();

        // 2. 处理INSERT语句的特殊情况
        if (formatted.startsWith('EXEC SQL INSERT INTO')) {
            return formatInsertStatement(formatted, baseIndent, indentSize);
        }
        if (formatted.startsWith('EXEC SQL DECLARE')) {
            return formatCursorStatement(formatted, baseIndent, indentSize);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`formatSQLString: ${error}`);
    }
    try {
        // 3. 定义关键字规则（新增lineAfter属性控制是否另起一行）
        interface KeywordRule {
            pattern: string;
            indentLvl: number;  // 关键字本身的缩进级别
            lineAfter: boolean;  // 关键字后是否另起一行
            lineBefore: boolean; // 关键字前是否另起一行
        }
        const keywordRules: KeywordRule[] = [
            { pattern: 'EXEC SQL', indentLvl: 0, lineBefore: true, lineAfter: true },
            // 以下关键字后必须另起一行并增加一级缩进
            { pattern: 'SELECT', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'DISTINCT', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'INSERT INTO', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'INTO', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'FROM', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'WHERE', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'SET', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'UPDATE', indentLvl: 1, lineBefore: true, lineAfter: true },
            // 其他关键字
            { pattern: 'VALUES', indentLvl: 1, lineBefore: true, lineAfter: true },
            { pattern: 'GROUP BY', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'ORDER BY', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'FOR', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'WITH', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'AND', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'OR', indentLvl: 1, lineBefore: true, lineAfter: false },
            { pattern: 'FETCH FIRST', indentLvl: 1, lineBefore: true, lineAfter: false }
        ].sort((a, b) => b.pattern.length - a.pattern.length); // 长关键字优先匹配
        // 4. 处理逻辑
        let tokens = formatted.split(' ');
        let i = 0;
        let currentIndent = 0;
        let pendingNewline = false;
        let inParentheses = false; // 标记是否在括号内
        let parenthesesIndent = 0; // 括号内的基准缩进

        while (i < tokens.length) {
            // 尝试匹配多词关键字
            let matchedRule = null;
            for (const rule of keywordRules) {
                const keywordParts = rule.pattern.split(' ');
                const potentialMatch = tokens.slice(i, i + keywordParts.length).join(' ');

                if (potentialMatch === rule.pattern) {
                    matchedRule = rule;
                    i += keywordParts.length - 1; // 跳过已匹配的部分
                    break;
                }
            }

            let currentToken = tokens[i];
            // 处理左括号
            if (currentToken === '(') {
                inParentheses = true;
                // 记录括号开始的位置缩进
                const lines = result.split('\n');
                const currentLine = lines[lines.length - 1] || '';
                parenthesesIndent = currentLine.match(/^\s*/)?.[0].length || 0;
                parenthesesIndent += indentSize; // 括号内容比括号多一级缩进
            }

            // 处理右括号
            if (currentToken === ')') {
                inParentheses = false;
                parenthesesIndent = 0;
            }

            // 处理逗号（改进版）
            if (currentToken === ',') {
                result += ',';

                // 如果在括号内，使用括号内的缩进级别
                if (inParentheses) {
                    result += '\n' + ' '.repeat(parenthesesIndent);
                }
                // 如果在VALUES子句中，保持与VALUES相同的缩进
                else if (result.includes('VALUES')) {
                    const valuesIndent = baseIndent + 2 * indentSize; // VALUES子句的缩进
                    result += '\n' + ' '.repeat(valuesIndent);
                }
                // 默认情况：使用当前行的缩进
                else {
                    result += '\n';
                    pendingNewline = true;
                }

                i++;
                continue;
            }
            if (matchedRule) {
                currentIndent = baseIndent + matchedRule.indentLvl * indentSize;
                // 处理关键字前的换行
                if (matchedRule.lineBefore && result.length > 0) {
                    result = result.trimEnd();
                    result += '\n';
                    pendingNewline = true;
                }

                // 添加关键字（带缩进）
                if (pendingNewline) {
                    result += ' '.repeat(currentIndent);
                    pendingNewline = false;
                } else if (result.length > 0) {
                    result += ' ';
                }
                if (matchedRule.pattern === 'EXEC SQL') {
                    result += ' '.repeat(currentIndent);
                }

                result += (matchedRule.pattern + ' ');

                // 处理关键字后的换行和缩进
                if (matchedRule.lineAfter) {
                    currentIndent = baseIndent + (matchedRule.indentLvl + 1) * indentSize;
                    result += '\n';
                    pendingNewline = true;
                }
            } else {
                // 处理非关键字内容
                if (pendingNewline) {
                    result += ' '.repeat(currentIndent);
                    pendingNewline = false;
                } else if (result.length > 0) {
                    result += '';
                }
                currentToken += ' ';
                result += currentToken;
            }

            i++;
        }

        // // 4. 处理逗号换行（保持原有缩进级别）
        // result = result.replace(/,(\s*\S)/g, (match, p1) => `,\n${' '.repeat(currentIndent)}${p1.trim()}`);
    } catch (error) {
        vscode.window.showErrorMessage(`formatSQLString: ${error}`);
    }
    return result.trimEnd();
}

/**
 * 计算当前行trim行末空格后的总字符数量，并补空格到4的倍数
 * @param line 当前行字符串
 * @returns 处理后的行字符串
 */
function padLineToMultipleOfFour(line: string): string {
    // 如果行中包含等号，直接返回原行（不处理）
    if (line.includes('=') || line.includes('<') || line.includes('>')) {
        return line + ' ';
    }
    // 1. 先trim行末空格
    const trimmedLine = line.trimEnd();

    // 2. 计算trim后的字符长度
    const length = trimmedLine.length;

    // 3. 计算需要补的空格数量
    const remainder = length % 4;
    const spacesToAdd = remainder === 0 ? 4 : (4 - remainder);

    // 4. 补空格
    return trimmedLine + ' '.repeat(spacesToAdd);
}

function formatInsertStatement(sql: string, baseIndent: number, indentSize: number): string {
    // 提取SQL语句各部分
    const execSqlPart = sql.match(/^EXEC SQL INSERT INTO/)?.[0] || 'EXEC SQL INSERT INTO';
    const rest = sql.slice(execSqlPart.length).trim();

    // 提取表名
    const tableNameEnd = rest.indexOf('(');
    if (tableNameEnd === -1) { return sql; }
    const tableName = rest.slice(0, tableNameEnd).trim();

    // 提取列名部分
    const columnsEnd = rest.indexOf(')');
    if (columnsEnd === -1) { return sql; }
    const columnsPart = rest.slice(tableNameEnd + 1, columnsEnd).trim();
    const columns = columnsPart.split(',').map(c => c.trim());

    // 提取VALUES部分
    const valuesStart = rest.indexOf('VALUES');
    if (valuesStart === -1) { return sql; }
    const valuesPart = rest.slice(valuesStart + 6).trim();

    // 提取值列表
    const valuesListStart = valuesPart.indexOf('(');
    const valuesListEnd = valuesPart.indexOf(')');
    if (valuesListStart === -1 || valuesListEnd === -1) { return sql; }
    const valuesList = valuesPart.slice(valuesListStart + 1, valuesListEnd).trim();
    const values = valuesList.split(',').map(v => v.trim());

    // 检查分号
    const hasSemicolon = valuesPart.includes(';');

    // 构建格式化后的SQL
    let result = '';
    result += ' '.repeat(baseIndent);

    const indent1 = ' '.repeat(baseIndent + indentSize);
    const indent2 = ' '.repeat(baseIndent + indentSize * 2);
    const indent3 = ' '.repeat(baseIndent + indentSize * 3);

    // 1. EXEC SQL部分
    result += 'EXEC SQL\n';

    // 2. INSERT INTO和表名
    result += `${indent1}INSERT INTO\n`;
    result += `${indent2}${tableName}\n`;

    // 3. 列名部分
    result += `${indent2}(\n`;
    columns.forEach((col, i) => {
        result += `${indent3}${col}`;
        if (i < columns.length - 1) { result += ','; }
        result += '\n';
    });
    result += `${indent2})\n`;

    // 4. VALUES部分
    result += `${indent1}VALUES\n`;
    result += `${indent2}(\n`;
    values.forEach((val, i) => {
        result += `${indent3}${val}`;
        if (i < values.length - 1) { result += ','; }
        result += '\n';
    });
    result += `${indent2})`;

    // 5. 分号
    if (hasSemicolon) {
        result += ';';
    }

    return result;
}

function formatCursorStatement(sql: string, baseIndent: number, indentSize: number): string {
    // 定义缩进级别
    const indent1 = ' '.repeat(baseIndent);          // 第一级缩进 (EXEC SQL)
    const indent2 = ' '.repeat(baseIndent + indentSize);      // 第二级缩进 (DECLARE)
    const indent3 = ' '.repeat(baseIndent + indentSize * 2);  // 第三级缩进 (SELECT/FROM)
    const indent4 = ' '.repeat(baseIndent + indentSize * 3);  // 第四级缩进 (列名)
    let result = [];
    try {
        // 标准化空格处理
        sql = sql.replace(/\s+/g, ' ').trim();
    } catch (error) {
        vscode.window.showErrorMessage(`formatCursorStatement error: ${error}`);
    }
    try {
        // 提取各部分（使用[\s\S]替代.实现跨行匹配）
        const declarePart = sql.match(/EXEC SQL DECLARE[\s\S]+?CURSOR FOR/)![0];
        const selectPart = sql.slice(declarePart.length).replace(';', '').trim();

        // 安全提取SELECT部分
        const selectMatch = selectPart.match(/SELECT([\s\S]+?)FROM/i);
        if (!selectMatch || !selectMatch[1]) {
            return indent1 + sql + '\n';
        }
        const selectColumns = selectMatch[1].trim();

        // 安全提取FROM部分
        const fromMatch = selectPart.match(/FROM([\s\S]+?)(WHERE|ORDER BY|$)/i);
        if (!fromMatch || !fromMatch[1]) {
            return indent1 + sql + '\n';
        }
        const fromTable = fromMatch[1].trim();

        // 安全提取WHERE部分
        const whereMatch = selectPart.match(/WHERE([\s\S]+?)(ORDER BY|$)/i);
        if (!whereMatch || !whereMatch[1]) {
            return indent1 + sql + '\n';
        }
        const whereClause = whereMatch && whereMatch[1] ? whereMatch[1].trim() : null;

        // 安全提取ORDER BY部分
        const orderByMatch = selectPart.match(/ORDER BY([\s\S]+?)(?=FOR READ ONLY|$)/i);
        const orderByClause = orderByMatch?.[1]?.trim();

        // 安全提取结尾标记
        const forReadOnly = selectPart.includes('FOR READ ONLY') ? 'FOR READ ONLY' : '';
        const withUR = selectPart.includes('WITH UR') ? 'WITH UR' : '';

        // 构建格式化后的SQL
        result.push(`${indent1}EXEC SQL`);
        result.push(`${indent2}${declarePart.replace('EXEC SQL', '').trim()}`);

        // 处理SELECT列
        result.push(`${indent3}SELECT`);
        selectColumns.split(',').forEach(col => {
            result.push(`${indent4}${col.trim()},`);
        });
        result[result.length - 1] = result[result.length - 1].slice(0, -1); // 移除最后一个逗号

        // 处理FROM
        result.push(`${indent3}FROM`);
        result.push(`${indent4}${fromTable}`);

        // 处理WHERE
        if (whereClause) {
            result.push(`${indent3}WHERE`);
            result.push(formatWhereClauseWithComments(whereClause, baseIndent + indentSize * 3, indentSize));
        }

        // 处理ORDER BY
        if (orderByClause) {
            // 将ORDER BY及其条件放在同一行
            let orderByLine = `${indent3}ORDER BY ${orderByClause}`;
            result.push(orderByLine);
        }

        // 处理结尾
        if (forReadOnly || withUR) {
            let endClause = [forReadOnly, withUR].filter(Boolean).join(' ');
            result.push(`${indent3}${endClause};`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`格式化失败: ${(error as Error).message}`);
    }
    return result.join('\n');
}
function formatWhereClauseWithComments(whereClause: string, baseIndent: number, indentSize: number): string {
    const mainIndent = ' '.repeat(baseIndent);
    const conditionIndent = ' '.repeat(Math.max(0, baseIndent - indentSize)); // 改为少一级缩进

    // 1. 保护注释内容
    const commentBlocks: string[] = [];
    let protectedWhere = whereClause.replace(/\/\*.*?\*\//g, match => {
        commentBlocks.push(match);
        return `COMMENT_${commentBlocks.length - 1}_PLACEHOLDER`;
    });

    // 2. 检测特殊语法
    const hasSpecialSyntax = /(FOR\s+READ\s+ONLY|WITH\s+UR)/i.test(protectedWhere);
    if (hasSpecialSyntax) {
        return mainIndent + whereClause.trim();
    }

    // 3. 基础格式化
    let formatted = protectedWhere
        .replace(/\s+/g, ' ')
        .replace(/\s*([()])\s*/g, ' $1 ')
        .trim();

    // 4. 分割条件
    const conditions = formatted.split(/(AND|OR)/i)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    // 5. 构建格式化行
    const lines: string[] = [];

    // 第一个条件
    if (conditions.length > 0) {
        lines.push(mainIndent + conditions[0]);
    }

    // 后续AND/OR条件（比前一行少一级缩进）
    for (let i = 1; i < conditions.length; i += 2) {
        if (i + 1 < conditions.length) {
            lines.push(conditionIndent + conditions[i] + ' ' + conditions[i + 1]);
        }
    }

    return lines.join('\n');
}