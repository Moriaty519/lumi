import { useState } from 'react';
import {
  EMOTION_LEVEL_LABELS,
  type JudgeRecord,
  type UserId,
  type UserProfile,
} from '../../../shared/types';
import { SheetModal } from './SheetModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

function cleanChatMarkdown(text: string) {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*\n])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '· ')
    .replace(/`+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function RecordsModal(props: {
  records: JudgeRecord[];
  onClose: () => void;
  meId: UserId;
  meName: string;
  users: Record<string, UserProfile>;
}) {
  const { users } = props;
  const [tab, setTab] = useState<'dual' | 'single'>('dual');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const dualList = props.records.filter((r) => r.mode === 'dual');
  const singleList = props.records.filter((r) => r.mode === 'single');
  const list = tab === 'dual' ? dualList : singleList;
  const detail = detailId ? props.records.find((r) => r.id === detailId) : null;
  const reportRec = reportId ? props.records.find((r) => r.id === reportId) : null;

  function speakerName(user: string, kind?: string) {
    if (user === 'lumi') return 'Lumi';
    if (user === 'system') return '系统';
    const name = users[user]?.name || user;
    if (user === props.meId) {
      return kind === 'opening' ? `我（${name}）· 开场` : `我（${name}）`;
    }
    return kind === 'opening' ? `${name} · 开场` : name;
  }

  function recordReportText(r: JudgeRecord) {
    return r.reportText || r.reportDual || r.reportPersonal || '';
  }

  function hasReports(r: JudgeRecord) {
    return Boolean(recordReportText(r));
  }

  function renderMsgList(
    msgs: { user: string; text: string; kind?: string }[] | undefined,
    emptyText: string
  ) {
    if (!msgs?.length) {
      return <p className="text-sm text-muted-foreground">{emptyText}</p>;
    }
    return (
      <ScrollArea className="records-msg-scroll h-[min(42vh,360px)] rounded-lg border">
        <div className="flex flex-col gap-2 p-3">
          {msgs.map((m, i) =>
            m.kind === 'system' || m.user === 'system' ? (
              <div
                key={i}
                className="px-2 py-1 text-center text-[11px] break-words text-[#636e72]"
              >
                {m.text}
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  'flex min-w-0 w-full',
                  m.user === props.meId ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'records-msg-bubble max-w-[88%] min-w-0 rounded-xl px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap',
                    m.user === props.meId && 'records-msg-bubble--me',
                    m.user === 'lumi' && 'records-msg-bubble--lumi',
                    m.user !== props.meId &&
                      m.user !== 'lumi' &&
                      'records-msg-bubble--other'
                  )}
                >
                  <div
                    className={cn(
                      'mb-0.5 font-semibold',
                      m.user === props.meId
                        ? 'text-white/90'
                        : m.user === 'lumi'
                          ? 'text-[#5f9a5e]'
                          : 'text-[#5f9a5e]'
                    )}
                  >
                    {speakerName(m.user, m.kind)}
                  </div>
                  <div>{m.text || '[图片]'}</div>
                </div>
              </div>
            )
          )}
        </div>
      </ScrollArea>
    );
  }

  function EmotionBadges({
    emotions,
    empty = '未标记',
  }: {
    emotions?: { name: string; level?: number }[];
    empty?: string;
  }) {
    if (!emotions?.length) {
      return <span className="text-sm text-muted-foreground">{empty}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {emotions.map((e) => (
          <Badge key={e.name} variant="secondary">
            {e.name}
            {e.level != null ? `·${EMOTION_LEVEL_LABELS[e.level] || e.level}` : ''}
          </Badge>
        ))}
      </div>
    );
  }

  if (reportRec) {
    return (
      <SheetModal
        title="调解报告"
        subtitle={`${reportRec.savedAt} · 双方同看`}
        onClose={props.onClose}
        hideCloseButton
        wide
        className="modal-records"
        footer={
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="records-btn records-btn-outline flex-1"
              onClick={() => setReportId(null)}
            >
              返回
            </Button>
            <Button className="records-btn records-btn-primary flex-1" onClick={props.onClose}>
              关闭
            </Button>
          </div>
        }
      >
        <div className="records-shadcn">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">报告正文</CardTitle>
              <CardDescription>双方同看 · 可上下滚动阅读</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[min(50vh,420px)] rounded-lg border bg-muted/20">
                <pre className="whitespace-pre-wrap break-words p-4 font-sans text-sm leading-relaxed text-foreground">
                  {cleanChatMarkdown(recordReportText(reportRec) || '（无报告）')}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </SheetModal>
    );
  }

  if (detail) {
    return (
      <SheetModal
        title="沟通记录"
        subtitle={
          detail.mode === 'single'
            ? `${detail.relationEmoji || ''} ${detail.relationLabel || '单人倾诉'} · ${detail.savedAt}`
            : `${props.meName}的视角 · ${detail.savedAt}`
        }
        onClose={props.onClose}
        hideCloseButton
        wide
        className="modal-records"
        footer={
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="records-btn records-btn-outline flex-1"
              onClick={() => setDetailId(null)}
            >
              返回列表
            </Button>
            {hasReports(detail) ? (
              <Button
                className="records-btn records-btn-primary flex-1"
                onClick={() => setReportId(detail.id)}
              >
                查看报告
              </Button>
            ) : (
              <Button className="records-btn records-btn-primary flex-1" onClick={props.onClose}>
                关闭
              </Button>
            )}
          </div>
        }
      >
        <div className="records-shadcn flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">我的情绪</CardTitle>
            </CardHeader>
            <CardContent>
              <EmotionBadges emotions={detail.emotions} />
            </CardContent>
          </Card>

          {detail.mode === 'dual' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{detail.otherName || '对方'}的情绪</CardTitle>
              </CardHeader>
              <CardContent>
                <EmotionBadges emotions={detail.emotionsOther} />
              </CardContent>
            </Card>
          )}

          {detail.assessmentLabel && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">我的关系速测</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground break-words">
                  {detail.assessmentLabel}
                </p>
              </CardContent>
            </Card>
          )}

          {detail.mode === 'dual' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">我的私聊</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderMsgList(detail.privateMessages, '无私聊记录')}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">树洞记录</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderMsgList(detail.courtMessages, '无群聊记录')}
                </CardContent>
              </Card>
            </>
          )}

          {detail.mode === 'single' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">倾诉记录</CardTitle>
              </CardHeader>
              <CardContent>
                {renderMsgList(detail.singleMessages, '无消息记录')}
              </CardContent>
            </Card>
          )}
        </div>
      </SheetModal>
    );
  }

  const emptyCopy =
    tab === 'dual'
      ? '暂无双人记录。完成调解或退出房间后会出现在这里。'
      : '暂无单人记录。退出本轮倾诉后会出现在这里。';

  return (
    <SheetModal
      title="沟通记录"
      subtitle={`${props.meName}可见 · 私聊仅自己 · 群聊/报告双方同看`}
      onClose={props.onClose}
      hideCloseButton
      wide
      className="modal-records"
      footer={
        <Button
          variant="outline"
          className="records-btn records-btn-outline w-full"
          onClick={props.onClose}
        >
          关闭
        </Button>
      }
    >
      <div className="records-shadcn">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'dual' | 'single')}
          className="gap-3"
        >
          <TabsList className="records-tabs-list w-full">
            <TabsTrigger value="dual" className="records-tabs-trigger">
              双人 ({dualList.length})
            </TabsTrigger>
            <TabsTrigger value="single" className="records-tabs-trigger">
              单人 ({singleList.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-0">
            {list.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <p className="text-center text-sm leading-relaxed text-muted-foreground">
                    {emptyCopy}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {list.map((r, i) => (
                  <Card key={r.id} className="gap-0 overflow-hidden py-0">
                    <button
                      type="button"
                      className="w-full min-w-0 text-left transition-colors hover:bg-accent/40"
                      onClick={() => setDetailId(r.id)}
                    >
                      <CardHeader className="gap-2 py-4">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <CardTitle className="min-w-0 flex-1 text-sm leading-snug break-words">
                            第 {list.length - i} 次 · {r.title}
                          </CardTitle>
                          <CardDescription className="shrink-0 text-xs">
                            {r.savedAt}
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={r.source === 'complete' ? 'default' : 'outline'}>
                            {r.source === 'complete' ? '结案' : '退出保存'}
                          </Badge>
                          {typeof r.courtCount === 'number' && r.mode === 'dual' ? (
                            <Badge variant="secondary">群聊 {r.courtCount} 条</Badge>
                          ) : null}
                          {typeof r.privateCount === 'number' ? (
                            <Badge variant="secondary">相关发言 {r.privateCount} 条</Badge>
                          ) : null}
                        </div>
                      </CardHeader>
                      {(r.summary || (r.emotions || []).length > 0 || r.assessmentLabel) && (
                        <>
                          <Separator />
                          <CardContent className="space-y-2 py-3">
                            {r.summary ? (
                              <p className="line-clamp-2 text-xs leading-relaxed break-words text-muted-foreground">
                                {r.summary}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-1.5">
                              {(r.emotions || []).map((e) => (
                                <Badge key={e.name} variant="outline">
                                  {e.name}
                                </Badge>
                              ))}
                              {r.assessmentLabel ? (
                                <Badge variant="secondary">已自测</Badge>
                              ) : null}
                            </div>
                          </CardContent>
                        </>
                      )}
                    </button>
                    {hasReports(r) && (
                      <>
                        <Separator />
                        <CardFooter className="py-3">
                          <Button
                            variant="outline"
                            className="records-btn records-btn-outline w-full"
                            onClick={() => setReportId(r.id)}
                          >
                            查看报告
                          </Button>
                        </CardFooter>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </SheetModal>
  );
}
