/**
 * Conversation / Chat page
 */

import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { formatDateTime } from '../lib/utils';
import type { Message } from '../types/api';

export function ConversationPage() {
  const { conversationId } = useParams<{
    _projectId: string;
    conversationId: string;
  }>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const { isLoading, setLoading, setError } = useAppStore();

  useEffect(() => {
    if (!conversationId) return;
    loadMessages();
  }, [conversationId]);

  useEffect(() => {
    // Auto-scroll to bottom
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);

    const result = await apiClient.get(
      `/conversations/${conversationId}/messages`,
      {
        query: { limit: 50, reverse: false },
      }
    );
    setLoading(false);

    if (result.ok) {
      setMessages(result.data.items);
    } else {
      setError(result.error.message);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !conversationId) return;

    const userMessage = input;
    setInput('');

    // Optimistic update
    const newMessage: Message = {
      id: `temp_${Date.now()}`,
      seq: messages.length + 1,
      role: 'user',
      parts: [{ kind: 'text', text: userMessage }],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);

    setLoading(true);
    const result = await apiClient.post(`/conversations/${conversationId}/messages`, {
      role: 'user',
      parts: [{ kind: 'text', text: userMessage }],
    });
    setLoading(false);

    if (!result.ok) {
      setError(result.error.message);
      // Revert optimistic update
      setMessages((prev) => prev.filter((m) => m.id !== newMessage.id));
    } else {
      // Replace temp message with real one
      setMessages((prev) =>
        prev.map((m) => (m.id === newMessage.id ? result.data : m))
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full p-6 gap-4 overflow-hidden">
      {/* Messages list */}
      <div className="flex-1 overflow-auto space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-text-secondary py-12">
            <p>开始对话</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={clsx(
                  'flex gap-3',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={clsx(
                    'max-w-md px-4 py-2 rounded-lg',
                    msg.role === 'user'
                      ? 'bg-accent text-white'
                      : 'bg-bg-card text-text-primary border border-border'
                  )}
                >
                  <p className="text-sm mb-1">{msg.parts.find((p) => p.kind === 'text')?.text}</p>
                  <p className="text-xs opacity-70">{formatDateTime(msg.createdAt)}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="输入消息..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          disabled={isLoading}
        />
        <Button
          variant="primary"
          onClick={handleSendMessage}
          disabled={!input.trim() || isLoading}
          isLoading={isLoading}
        >
          发送
        </Button>
      </div>
    </div>
  );
}

import clsx from 'clsx';
