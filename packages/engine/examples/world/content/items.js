// Items: id -> name, icon, description. stack is the max per slot (default 99); color is the color when dropped on the ground.
export default {
  film: { name: '胶卷', icon: '🎞', desc: '每拍一张用掉一格', stack: 36 },
  berry: { name: '野莓', icon: '🫐', desc: '路边摘的，有点酸', color: 0x6a5acd },
  feather: { name: '羽毛', icon: '🪶', desc: '不知道是什么鸟的', color: 0xf4efe2 },
  wood: { name: '木头', icon: '🪵', desc: '砍树得到的', color: 0x8a5a36 },
};

// Starting inventory
export const startItems = { film: 12 };
