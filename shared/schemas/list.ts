/** One row on a person's home page: a list they own. */
export interface HomeList {
  token: string
  title: string
  /** Live wishes only. */
  wishes: number
}
