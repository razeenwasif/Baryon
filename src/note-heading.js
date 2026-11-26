// What a note from another session says about itself, in a line: in the window's cards and on the phone.
export function noteHeading(entry) {
  const title = `“${entry.from?.title || 'a session'}”`, status = entry.note?.status;
  const ending = status === 'stopped' ? ', which stopped' : status === 'failed' ? ', which ran into a problem' : '';
  switch (entry.from?.kind) {
    case 'brief': return `Task from ${title}`;
    case 'message': case 'reply': return `Message from ${title}`;
    case 'peer': return `Message from ${title}${entry.from.by === 'user' ? ', sent by you' : ''}`;
    case 'peer-reply': return `Reply from ${title}${ending}`;
    case 'sent': return `To ${title}`;
    default: return status === 'stopped' ? `${title} stopped` : status === 'failed' ? `${title} ran into a problem` : `${title} finished a turn`;
  }
}
