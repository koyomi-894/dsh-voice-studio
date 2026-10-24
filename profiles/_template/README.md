# 角色模板

复制这个目录到 profiles/ 下并改名（目录名就是角色 id），例如：

    profiles/my-voice/

然后编辑 profile.json：

- id：角色唯一标识，和目录名一致（字母数字下划线连字符）
- name：显示名称
- tts.engine：gpt-sovits（本地模型）或 sapi（系统内置语音，无需模型）
- tts.refAudio：参考音频绝对路径（sapi 可留空）
- tts.promptText：参考音频的逐字稿，必须和音频内容一致
- tts.baseUrl：GPT-SoVITS 服务地址，默认 http://127.0.0.1:9880
- svc.baseUrl：唱歌服务地址，留空则该角色不支持唱歌
- assets/：放 icon.png（立绘）和 background.webp（背景图），图片会自动被读取

改完在插件「模型」页点「刷新本地模型」即可看到新角色。
