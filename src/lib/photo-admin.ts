/**
 * Who may replace an exercise PHOTO on a row they don't own.
 *
 * Editing the shared library is otherwise owner-only (a Week-1 security fix:
 * before it, any user could rewrite global seed exercises). But the 2026-07-17
 * dedupe left most merged survivors owned by the global library or the other
 * user, so the image-refresh control disappeared from movements Ivo actively
 * uses. Ivo's call: a small allowlist that can regenerate IMAGES ONLY.
 *
 * Deliberately narrow - allowlisted users still cannot rename, re-tag, or
 * delete an exercise they don't own. Ids (not emails) so nothing identifying
 * ends up in the client bundle; the server check is the authoritative one, the
 * client copy only decides whether to render the button.
 */
export function photoAdminIds(): string[] {
  return (process.env.NEXT_PUBLIC_PHOTO_ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isPhotoAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return photoAdminIds().includes(userId);
}

/** Owner, or an allowlisted user acting on the shared library. */
export function canRegenerateImage(
  userId: string | null | undefined,
  exerciseUserId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return exerciseUserId === userId || isPhotoAdmin(userId);
}
