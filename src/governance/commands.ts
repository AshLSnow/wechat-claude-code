import type { CommandContext, CommandResult } from '../commands/router.js';

function requireAdmin(ctx: CommandContext): CommandResult | null {
  if (ctx.instance.role === 'admin') return null;
  return { handled: true, reply: '⛔ 只有管理员实例可以执行审批操作。' };
}

export function handleRequest(ctx: CommandContext, args: string): CommandResult {
  if (!args.trim()) {
    return {
      handled: true,
      reply: '用法: /request <修改需求>\n请求会写入 Git 审批账本，等待管理员实例处理。',
    };
  }
  try {
    const request = ctx.approvalStore.submit({
      requesterInstanceId: ctx.instance.id,
      requesterAccountId: ctx.accountId,
      workingDirectory: ctx.session.workingDirectory,
      prompt: args,
    });
    return {
      handled: true,
      reply: [
        '✅ 修改请求已提交',
        `请求号: ${request.id}`,
        `目标仓库: ${request.targetRepo}`,
        '状态: pending',
      ].join('\n'),
    };
  } catch (error) {
    return { handled: true, reply: `❌ 提交失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function handleRequests(ctx: CommandContext, args: string): CommandResult {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  try {
    const showAll = args.trim().toLowerCase() === 'all';
    const requests = showAll ? ctx.approvalStore.list() : ctx.approvalStore.list('pending');
    if (requests.length === 0) {
      return { handled: true, reply: showAll ? '暂无修改请求。' : '暂无待审批请求。' };
    }
    const lines = requests.slice(0, 20).map((request) => [
      `${request.id} [${request.status}]`,
      `  来自: ${request.requesterInstanceId}`,
      `  仓库: ${request.targetRepo}`,
      `  内容: ${request.prompt.replace(/[\r\n]+/g, ' ').slice(0, 160)}`,
    ].join('\n'));
    return {
      handled: true,
      reply: `📋 修改请求 (${requests.length})\n\n${lines.join('\n\n')}\n\n/approve <请求号>\n/reject <请求号> [原因]`,
    };
  } catch (error) {
    return { handled: true, reply: `❌ 读取审批账本失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function handleApprove(ctx: CommandContext, args: string): CommandResult {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const id = args.trim().split(/\s+/, 1)[0];
  if (!id) return { handled: true, reply: '用法: /approve <请求号>' };
  try {
    const execution = ctx.approvalStore.prepareApproval(id, ctx.instance.id);
    return {
      handled: true,
      claudePrompt: execution.prompt,
      cwdOverride: execution.cwd,
      approvalRequestId: execution.request.id,
      queryPermission: 'admin',
    };
  } catch (error) {
    return { handled: true, reply: `❌ 无法批准请求: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function handleReject(ctx: CommandContext, args: string): CommandResult {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const [id, ...reasonParts] = args.trim().split(/\s+/);
  if (!id) return { handled: true, reply: '用法: /reject <请求号> [原因]' };
  try {
    const request = ctx.approvalStore.reject(id, ctx.instance.id, reasonParts.join(' '));
    return { handled: true, reply: `✅ 已拒绝请求 ${request.id}` };
  } catch (error) {
    return { handled: true, reply: `❌ 无法拒绝请求: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function handleRecover(ctx: CommandContext, args: string): CommandResult {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const id = args.trim().split(/\s+/, 1)[0];
  if (!id) return { handled: true, reply: '用法: /recover <请求号>' };
  try {
    const finalized = ctx.approvalStore.finalizeApproval(id, '管理员收口了中断的审批执行');
    return { handled: true, reply: `✅ ${finalized.message}` };
  } catch (error) {
    return { handled: true, reply: `❌ 无法恢复请求: ${error instanceof Error ? error.message : String(error)}` };
  }
}
