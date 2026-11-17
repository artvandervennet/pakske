import { listDirectory } from '../../domain/public-list'

export default defineEventHandler(() => listDirectory(useDb()))
