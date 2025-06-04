"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const winston = require('winston');
// 创建 Logger 实例
const logger = winston.createLogger({
    level: 'info', // 记录 info 及以上级别（warn/error）
    transports: [
        new winston.transports.File({
            filename: 'formatsqc.log', // 错误日志输出到文件
            level: 'info'
        })
    ]
});
function fullDocumentRange(document) {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}
function activate(context) {
    const formatter = vscode.languages.registerDocumentFormattingEditProvider('sqc', {
        provideDocumentFormattingEdits(document) {
            const edits = [];
            // 解析SQC文件并生成格式化后的文本
            const formattedText = formatSQCCode(document.getText());
            edits.push(vscode.TextEdit.replace(fullDocumentRange(document), formattedText));
            return edits;
        }
    });
    // 新增命令注册
    const formatCommand = vscode.commands.registerCommand('format-sqc.formatsqc', () => {
        vscode.commands.executeCommand('editor.action.formatDocument');
    });
    context.subscriptions.push(formatter, formatCommand);
}
function formatSQCCode(text) {
    const lines = text.split('\n');
    let formattedLines = [];
    let indentLevel = 0;
    let inSQLBlock = false;
    const sqlIndent = indentLevel + 1; // SQL 块固定缩进级别
    const MAIN_SQL_KEYWORDS = ['SELECT', 'INTO', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'FOR'];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/\t/g, '    ').trim();
        logger.error('%d: %s', i, line);
        // 处理 SQL 块开始/结束
        if (line.startsWith('EXEC SQL')) {
            inSQLBlock = true;
            formattedLines.push(' '.repeat(indentLevel * 4) + line);
            continue;
        }
        else if (inSQLBlock && line.includes(';')) {
            const [sqlPart, nonSqlPart] = line.split(';', 2);
            formattedLines.push(' '.repeat(sqlIndent * 4) + sqlPart + ';');
            inSQLBlock = false;
            if (nonSqlPart?.trim()) {
                formattedLines.push(' '.repeat(indentLevel * 4) + nonSqlPart);
            }
            continue;
        }
        // SQL 块格式化（核心改进）
        if (inSQLBlock) {
            // 主关键字对齐（SELECT/INTO/FROM等）[5](@ref)
            const isMainKeyword = MAIN_SQL_KEYWORDS.some(kw => new RegExp(`^${kw}\\b`, 'i').test(line));
            if (isMainKeyword) {
                line = ' '.repeat(sqlIndent * 4) + line;
            }
            // 字段/变量列表缩进（比主关键字多一级）[6](@ref)
            else if (line.match(/^(:?\w+)(,|\s*--.*)?$/)) {
                line = ' '.repeat((sqlIndent + 1) * 4) + line;
            }
            // 连接词对齐（AND/OR 与 WHERE 同级）[5](@ref)
            else if (line.match(/^(AND|OR)\b/i)) {
                line = ' '.repeat(sqlIndent * 4) + line;
            }
            formattedLines.push(line);
            continue;
        }
        // C 代码格式化
        // 减少缩进：右括号、else 等
        if (line.includes('}') || line.includes('} else')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        // 添加当前缩进
        line = ' '.repeat(indentLevel * 4) + line;
        // 运算符空格处理（排除指针操作 ->）
        line = line
            .replace(/(?<!->)([!=<>]=?|\+|\-|\*|\/|%|\|\||&&)(?!>)/g, ' $1 ')
            .replace(/\s+/g, ' ');
        formattedLines.push(line);
        // 增加缩进：左括号、行末 {
        if (line.includes('{') || line.endsWith('(')) {
            indentLevel++;
        }
    }
    return formattedLines.join('\n');
}
//# sourceMappingURL=extension.js.map