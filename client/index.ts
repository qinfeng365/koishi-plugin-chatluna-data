import { Context, icons } from '@koishijs/client'
import { defineComponent, h } from 'vue'
import page from './page.vue'

icons.register(
    'chatluna-data:delta',
    defineComponent({
        render() {
            return h(
                'svg',
                {
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    xmlns: 'http://www.w3.org/2000/svg'
                },
                [
                    h(
                        'path',
                        {
                            d: 'M12 4L21 20H3L12 4Z',
                            stroke: 'currentColor',
                            'stroke-width': '2',
                            'stroke-linejoin': 'round'
                        }
                    )
                ]
            )
        }
    })
)

export default (ctx: Context) => {
    ctx.page({
        name: 'ChatLuna 数据',
        path: '/chatluna-data',
        icon: 'chatluna-data:delta',
        authority: 3,
        component: page
    })
}
