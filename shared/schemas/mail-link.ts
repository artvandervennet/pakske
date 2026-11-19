/**
 * What the link in one of Firebase's mails is for. `email` is the address the account has once
 * the link is used; `previous` the address it has until then (`change_email`), or the one a
 * change gave it and this link takes away again (`recover_email`), when Firebase says.
 */
export interface MailLink {
  kind: 'reset_password' | 'verify_email' | 'change_email' | 'recover_email'
  email: string
  previous?: string
}
