<template>
  <div class="story-panel">
    <div class="toolbar"><h2>分镜面板</h2><button @click="generatePrompt">生成模型提示词</button><button class="primary" @click="$emit('push')">确认并放入画布</button></div>
    <div v-for="board in boards" :key="board.id" class="board">
      <h3>{{ board.shotNo }} · {{ board.duration }}秒 · {{ board.videoMode }}</h3>
      <div class="assets">
        <div v-for="asset in boardAssets(board)" :key="asset.id" class="asset">
          <img v-if="asset.imagePath" :src="asset.imagePath"><span>{{asset.kind}}：{{asset.name}}</span>
          <select v-model="asset.id" @change="replaceAsset(board,asset.id)"><option :value="asset.id">当前版本</option></select>
        </div>
      </div>
      <label>分镜设计<textarea v-model="board.excerpt"/></label>
      <label>视频提示词<textarea v-model="board.videoPrompt"/></label>
    </div>
  </div>
</template>
<script setup>
const props=defineProps({boards:Array,assets:Array});
function boardAssets(board){return (board.assetIds||board.assets||[]).map(id=>props.assets.find(a=>a.id===id)).filter(Boolean)}
function replaceAsset(board,id){board.assetIds=board.assetIds.map(x=>x===id?id:x)}
function generatePrompt(){props.boards.forEach(b=>{b.videoPrompt=`${b.videoMode} ${b.referenceMode||''}，${b.excerpt||''}，保持角色、场景、动作连续性。`;b.status='待确认提示词'})}
</script>
<style scoped>
.story-panel{padding:20px}.toolbar{display:flex;gap:12px;align-items:center}.toolbar h2{flex:1}.board{border:1px solid #333;padding:16px;margin:12px 0;border-radius:10px}.assets{display:flex;gap:10px}.asset{width:160px}.asset img{width:100%;height:100px;object-fit:cover}.asset span{display:block}.board textarea{width:100%;min-height:80px;background:#111;color:#fff}.primary{background:#347cdc;color:white}
</style>
