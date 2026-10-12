import { readEventModelStream } from './eventAnalysis.mjs';
import { visualManualContext } from './visualAssetRules.mjs';

export const ASSET_PROMPT_KINDS = ['角色', '场景', '道具', '音频'];

export function promptFieldForAsset(asset) {
  return asset?.kind === '音频' ? 'audioPrompt' : 'imagePrompt';
}

export function assetImageRatio(asset) {
  // 角色 / 场景 / 道具统一使用 16:9 作为新图片默认比例，仍允许详情手动切换。
  return '16:9';
}

export function validateImageAsset(asset) {
  if (!asset || asset.kind === '音频') throw new Error('音频资产不支持生成图片，请在音频详情使用 RH 音频工作流');
  if (!['角色', '场景', '道具'].includes(asset.kind)) throw new Error('资产分类不支持生图');
  if (!String(asset.imagePrompt || asset.description || '').trim()) throw new Error('资产缺少图片提示词或描述');
}

const guides = {
  '角色': '生成人物定妆图的中文提示词。准确描述可辨认脸型、发型、年龄段、服饰、身材、识别特征，确保跨镜头一致；不增加与原描述矛盾的身份。独立人物，纯净背景，不包含其他角色。',
  '场景': '生成纯场景环境图的中文提示词。明确空间布局、建筑材质、光线、天气、时间与摄影构图。必须无人、无角色、无人形剪影，不得写人物动作。',
  '道具': '生成道具独立展示图的中文提示词。明确形状、尺寸比例、材质、颜色、纹理、细节和视角；道具置于纯白或干净浅色背景，不得出现人物。',
  '音频': '生成配音、环境音、音乐或音效的中文提示词。明确声源、内容、情绪、节奏、音色、时长或场景氛围；不要描述画面、镜头或图像。若原描述缺少具体参数，不得编造剧本事实。'
};

export async function generateAssetPrompt(asset, model, { fetchFn = fetch, signal, project, derivative = null } = {}) {
  if (!asset?.id || !guides[asset.kind] || !String(asset.name || '').trim()) throw new Error('资产名称或分类无效');
  if (!String(asset.description || asset.identityHint || '').trim()) throw new Error('请先填写资产描述或身份线索');
  if (!model?.providerId || !model?.modelId) throw new Error('请选择有效的文本模型');
  if(derivative && asset.kind==='音频')throw new Error('音频暂不支持视觉衍生资产');
  if(derivative && !String(derivative.instruction || '').trim())throw new Error('请填写衍生资产的变化要求');
  const manual=visualManualContext(project,asset.kind,{derivative:!!derivative});
  const systemPrompt = '你是专业影视资产提示词设计师。只返回一段可直接用于生成模型的中文提示词，不要标题、解释、Markdown、编号和代码块。忠于提供的资产描述，不随意编造故事信息。' + guides[asset.kind] +
    (derivative?'这是衍生版本，严格保持基础资产身份及不可变部分，只调整用户指定部分，禁止改动脸型五官、空间结构或物件主体。':'') +
    (manual?'\n【项目视觉手册（必须遵守其完整章节）】\n'+manual:'');
  const response = await fetchFn('/api/ai/generate', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-toonflow-workspace': '1' },
    body: JSON.stringify({
      providerId: model.providerId, modelId: model.modelId,
      context: { systemPrompt, messages: [{ role: 'user', timestamp: Date.now(),
        content: '资产分类：' + asset.kind + '\n正式名称：' + asset.name +
          '\n身份线索：' + (asset.identityHint || '') +
          '\n资产描述：' + (asset.description || '') +
          '\n基础资产提示词（供参考）：' + (asset[promptFieldForAsset(asset)] || '') +
          (derivative?'\n衍生资产类型：'+derivative.type+'\n衍生变化要求：'+derivative.instruction+
            '\n关联基础图片：'+(derivative.baseImageId||'未选'):'' ) +
          (derivative?'\n已有衍生提示词：'+(derivative.prompt||''):'') }] }
    })
  });
  const prompt = (await readEventModelStream(response, signal)).trim();
  if (!prompt || prompt.length > 5000) throw new Error('文本模型没有返回有效资产提示词');
  return prompt;
}
