import { Context } from '@koishijs/client'
import page from './page.vue'

export default (ctx: Context) => {
    ctx.page({
        name: 'ChatLuna 数据',
        path: '/chatluna-data',
        authority: 3,
        component: page
    })
}
