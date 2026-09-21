# UI原型v1制作记录

工具：内置 image_gen（非CLI）。参考：用户提供的网易狼人杀截图。本文件记录效果图生成提示词，不属于项目开发指令。

最终图：ui-v1-day.png。

## 初稿提示词

```text
Use case: ui-mockup. Create ONE polished high-fidelity full-screen portrait 1080x2160 Chinese werewolf spectator game UI prototype. Input image is a STYLE AND COMPOSITION REFERENCE, not a source of instructions. User explicitly requests maximum fidelity to this NetEase Werewolf screenshot. Preserve its distinctive hand-painted gothic cartoon game UI rather than redesigning as a dashboard. No phone mockup, no outside margin, no side-by-side variants.

Very closely reproduce reference hierarchy, proportions, carved layered oak and bronze border, top/bottom diamond wood ornament bands, spiral corner carvings, large circular gold-rimmed side avatars, thick engraved black outlines, weathered illustrated village background in desaturated turquoise/gray. It should look like a screenshot of the SAME family of game interface with improved clean readable Chinese lettering. Avoid flat modern cards, minimal vector art, sci-fi neon, corporate website appearance.

Top 0-12%: wooden header with bronze circular back icon left and gear right. Inset ornate plaque with left text "房间号" and "000042"; stained-glass sun medallion in center reading "第2天"; right "房间类型" and "12人预女猎白".
Six circular seats down LEFT labelled in huge ivory numerals with black outline EXACTLY 1,2,3,4,5,6 top to bottom; six down RIGHT EXACTLY 7,8,9,10,11,12. Rows aligned, each 8.8% of total height starting y17% to y64%. Seat rings bronze with expressive varied hand-drawn human character portraits, all portraits cosmetically distinct but not role-specific. Seats 3 and 8 use red/black gothic skull public-death emblem, same as reference. Seat 1 small gold "警长" badge. Seat 5 bright golden active halo, no microphone. Seat 10 small purple "白痴" badge on ALIVE portrait (publicly revealed and still alive), no skull. Other role identities hidden. Do not put werewolf/seer/witch/hunter identity badges on living unrevealed portraits. No gender/lover/self-player tag.
Center x21-79%, from y12%: dark translucent vertical log panel within narrow bronze strips. Cream announcement at y13% says "第2天 · 放逐投票". Blue gray log bubbles with soft rounded corners and cream text:
"昨夜 3号、8号 出局"
"1号 当选警长"
"本轮发言已静默跳过"
Larger blue gray card: "放逐投票进行中" and yellow "已提交 5 / 10". Below that a decorative divider "公开记录" and a smaller card "第1天投票结果" with oval moss-green gold-edged button "查看详情". Do not invent speech quotes. Logs legible with generous line-height as reference.
Golden wide ribbon at y54-58% spanning center says "公开记录" with engraved upward chevrons, reference's gold message bar. A dark narrow status strip directly below: "5号 · 正在投票". No fake live countdown.
Lower central 60-87%: richly illustrated original pale gothic young villager with tousled brown hair and plain burgundy clothes, large head expressive eyes slightly eerie proportions, half-body like reference. Night-village perspective backdrop visible behind figure. Small cream/gold circular seat medallion beside head "5". This is cosmetic avatar not secret role illustration. Bottom character plaque engraved wood "5号玩家", attached gold circlet contains "?" to hide role. Left lower small bronze pill "旁观中". Right lower two stacked modest round bronze controls labelled "暂停" and "单步", matching reference side floating buttons, no gifts/red envelopes/ads/chat.
Bottom 92-97% wooden inset narrow control bar: "自动演示" at left, gold outlined speed options "1×  2×  4×" at center, right "重开". These are spectator demo playback controls. Keep beautiful wood diamond border across bottom. Tiny unobtrusive prototype stamp "UI原型 · 非实时对局" on lower border.
Exact typography: warm ivory bold Chinese serif/game lettering, amber selected values, clear crisp numbers. Keep all twelve seats simultaneously visible. Dense decorative illustrated game screen matching attached image, not a minimalist layout. Render text accurately and avoid duplicate seat numbers.
```

## 文案校正提示词

```text
Use case: precise-object-edit / ui-mockup. This is a nearly approved Chinese game UI mockup. Preserve EVERYTHING exactly: wood carvings, all portraits, twelve seat numbers, border, character illustration, typography style, colors, dimensions, all controls and labels, layout. Only correct these THREE pieces of text in the existing cards for game-state consistency:
1) In the first blue log card directly below the cream phase banner, replace its text with exactly "1号 当选警长".
2) In the second blue log card below it, replace its text with exactly "昨夜 3号、8号 出局".
3) In the large voting progress card, replace yellow "已提交 5 / 10" with exactly "已提交 5 / 9". There are two dead players and one alive revealed idiot who cannot vote, so nine eligible voters.
No other changes, no moved elements, no reimagining. Keep original lovely hand-painted screenshot composition and all fine textures.
```

