import type { SuspensionAwaiting } from './suspension.types';

/**
 * Formats aggregated replies from multiple respondents into a single
 * prompt text for the suspended agent to consume upon resume.
 */
export class InquiryAggregator {
  buildAggregatedReply(awaitingList: SuspensionAwaiting[]): string {
    const resolved = awaitingList.filter(a => a.status === 'resolved' && a.response);

    if (resolved.length === 0) return '';

    if (resolved.length === 1) {
      const inq = resolved[0];
      return `The role you previously asked (${inq.respondentRoleId}) has replied:\n\n${inq.response}`;
    }

    // Multiple replies — structured aggregation format
    const parts: string[] = ['All your previous questions have been answered:\n'];
    for (const inq of resolved) {
      parts.push(`## Reply from ${inq.respondentRoleId}\n${inq.response}\n`);
    }
    parts.push('Please continue your work based on all the replies above.');

    return parts.join('\n');
  }
}
