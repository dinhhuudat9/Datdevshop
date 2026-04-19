// ============================================
// BAI DANG PAGE
// File: frontend/js/pages/baidang.js
// ============================================

window.pageInit = async function() {
    const form = document.getElementById('post-form');
    const list = document.getElementById('post-list');
    const mediaInput = document.getElementById('post-media');
    const previewContainer = document.getElementById('post-upload-previews');
    const mediaLabel = document.getElementById('post-media-label');
    const currentUser = Auth.getCurrentUser();
    const isAdmin = currentUser?.role === 'admin';

    let files = [];

    await loadPosts();
    initFilePickers();

    mediaInput.addEventListener('change', () => {
        files = Array.from(mediaInput.files || []);
        renderPreviews();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = form.content.value.trim();
        const mediaUrl = form.media_url ? form.media_url.value.trim() : '';
        if (!content) {
            showToast('Vui lòng nhập nội dung', 'error');
            return;
        }

        if (!files.length && !mediaUrl) {
            showToast('Vui lòng upload hoặc nhập link ảnh/video', 'error');
            return;
        }

        try {
            const media = [];
            if (files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (!file.type.startsWith('image/')) {
                        showToast('Chỉ hỗ trợ upload ảnh', 'error');
                        return;
                    }

                    const card = previewContainer.querySelector(`[data-index="${i}"]`);
                    const bar = card ? card.querySelector('.upload-progress-bar') : null;
                    const text = card ? card.querySelector('.upload-progress-text') : null;

                    const fd = new FormData();
                    fd.append('file', file);
                    const upload = await api.uploadWithProgress('/uploads', fd, (percent) => {
                        if (bar) bar.style.width = `${percent}%`;
                        if (text) text.textContent = `${percent}%`;
                    });
                    if (upload.success) {
                        media.push({
                            media_type: 'image',
                            media_url: upload.data.url
                        });
                    }
                }
            }

            if (mediaUrl) {
                if (!/^https?:\/\//i.test(mediaUrl)) {
                    showToast('Link media phải bắt đầu bằng http hoặc https', 'error');
                    return;
                }
                media.push({
                    media_type: guessMediaType(mediaUrl),
                    media_url: mediaUrl
                });
            }

            const response = await api.post('/posts', { content, media });
            if (response.success) {
                showToast('Đăng bài thành công', 'success');
                form.reset();
                files = [];
                setFileLabel(mediaInput, mediaLabel);
                renderPreviews();
                await loadPosts();
            }
        } catch (error) {
            showToast(error.message || 'Không thể đăng bài', 'error');
        }
    });

    function guessMediaType(url) {
        const lower = url.toLowerCase();
        if (lower.match(/\.(mp4|webm|ogg|mov|avi)(\?.*)?$/)) return 'video';
        return 'image';
    }

    async function loadPosts() {
        try {
            const response = await api.get('/posts');
            if (response.success) {
                renderPosts(response.data.posts || []);
            }
        } catch (error) {
            list.innerHTML = '<p>Không thể tải bài đăng.</p>';
        }
    }

    function renderPosts(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có bài đăng nào.</p>';
            return;
        }

        list.innerHTML = items.map(post => `
            <div class="post-card" data-post-id="${post.id}">
                <div class="post-header">
                    <a href="${getProfileHref(post.user_id)}" class="post-user post-author-link" data-profile-link="${post.user_id}">
                        ${renderAvatarWithFrame({ avatar: post.avatar, gender: post.gender, frame_url: post.frame_url }, 'md', post.full_name)}
                        <div>
                            <strong>${renderDisplayName(post, post.full_name)}</strong>
                            <div class="post-meta">${formatDate(post.created_at)}</div>
                        </div>
                    </a>
                </div>
                <div class="post-content">${post.content}</div>
                ${renderMedia(post.media || [])}
                ${post.is_archived ? '<div class="badge badge-info">Bài viết đã lưu trữ</div>' : ''}
                <div class="post-actions">
                    <button class="btn-ghost btn-like ${post.is_liked ? 'active' : ''}" data-like="${post.id}" ${post.is_archived ? 'disabled' : ''}>
                        <i class="fas fa-thumbs-up"></i> Thích (${post.like_count || 0})
                    </button>
                    <button class="btn-ghost" data-toggle-comments="${post.id}" ${post.is_archived ? 'disabled' : ''}>
                        <i class="fas fa-comment"></i> Bình luận (${post.comment_count || 0})
                    </button>
                </div>
                <div class="post-comments" id="comments-${post.id}" style="display:none;">
                    <div class="comment-list"></div>
                    <form class="comment-form" data-comment-form="${post.id}">
                        <input type="text" name="content" placeholder="Viết bình luận..." required ${post.is_archived ? 'disabled' : ''}>
                        <button type="submit" class="btn-primary" ${post.is_archived ? 'disabled' : ''}>Gửi</button>
                    </form>
                </div>
            </div>
        `).join('');

        bindPostActions();
        bindProfileLinks(list);
    }

    function getProfileHref(userId) {
        return userId ? `/trangcanhan/${userId}` : '#';
    }

    function bindProfileLinks(root = document) {
        root.querySelectorAll('a[data-profile-link]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (!href || href === '#') return;
                if (window.router) {
                    window.router.navigate(href);
                    return;
                }
                window.location.href = href;
            });
        });
    }

    function renderMedia(media) {
        if (!media.length) return '';
        return `
            <div class="media-grid">
                ${media.map(m => `
                    <div class="media-item">
                        ${m.media_type === 'video' ? `
                            <video controls src="${m.media_url}"></video>
                        ` : `
                            <img src="${m.media_url}" alt="media">
                        `}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function bindPostActions() {
        list.querySelectorAll('button[data-like]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.disabled) {
                    showToast('Bài viết đã lưu trữ, không thể tương tác', 'warning');
                    return;
                }
                const postId = btn.dataset.like;
                try {
                    const res = await api.post(`/posts/${postId}/like`);
                    if (res.success) {
                        await loadPosts();
                    }
                } catch (error) {
                    showToast(error.message || 'Không thể like', 'error');
                }
            });
        });

        list.querySelectorAll('button[data-toggle-comments]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.disabled) {
                    showToast('Bài viết đã lưu trữ, không thể bình luận', 'warning');
                    return;
                }
                const postId = btn.dataset.toggleComments;
                const box = document.getElementById(`comments-${postId}`);
                if (!box) return;
                if (box.style.display === 'none') {
                    box.style.display = 'block';
                    await loadComments(postId);
                } else {
                    box.style.display = 'none';
                }
            });
        });

        list.querySelectorAll('form[data-comment-form]').forEach(formEl => {
            formEl.addEventListener('submit', async (e) => {
                e.preventDefault();
                const postId = formEl.dataset.commentForm;
                const content = formEl.content.value.trim();
                if (formEl.querySelector('[disabled]')) {
                    showToast('Bài viết đã lưu trữ, không thể bình luận', 'warning');
                    return;
                }
                if (!content) return;
                try {
                    const res = await api.post(`/posts/${postId}/comments`, { content });
                    if (res.success) {
                        formEl.content.value = '';
                        await loadComments(postId);
                        await loadPosts();
                    }
                } catch (error) {
                    showToast(error.message || 'Không thể bình luận', 'error');
                }
            });
        });
    }

    async function loadComments(postId) {
        try {
            const res = await api.get(`/posts/${postId}/comments`);
            if (res.success) {
                const box = document.querySelector(`#comments-${postId} .comment-list`);
                if (!box) return;
                const items = res.data || [];
                if (!items.length) {
                    box.innerHTML = '<p>Chưa có bình luận.</p>';
                    return;
                }
                box.innerHTML = items.map(c => `
                    <div class="comment-item">
                        <a href="${getProfileHref(c.user_id)}" class="comment-author-link" data-profile-link="${c.user_id}">
                            ${renderAvatarWithFrame({ avatar: c.avatar, gender: c.gender, frame_url: c.frame_url }, 'sm', c.full_name)}
                        </a>
                        <div class="comment-body">
                            <div class="comment-head">
                                <a href="${getProfileHref(c.user_id)}" class="comment-author-link" data-profile-link="${c.user_id}">
                                    <strong>${renderDisplayName(c, `User #${c.user_id}`)}</strong>
                                </a>
                                ${(isAdmin || Number(currentUser?.id) === Number(c.user_id)) ? `
                                    <button type="button" class="btn-ghost btn-danger comment-delete-btn" data-comment-delete="${c.id}" data-post-id="${postId}">Xóa</button>
                                ` : ''}
                            </div>
                            <div class="comment-text">${escapeHtml(c.content || '')}</div>
                            <div class="comment-meta">${formatDateShort(c.created_at)}</div>
                        </div>
                    </div>
                `).join('');
                bindProfileLinks(box);
                box.querySelectorAll('button[data-comment-delete]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        if (!confirm('Xóa bình luận này?')) return;
                        try {
                            const targetPostId = btn.dataset.postId;
                            const commentId = btn.dataset.commentDelete;
                            const resp = await api.delete(`/posts/${targetPostId}/comments/${commentId}`);
                            if (resp.success) {
                                showToast('Đã xóa bình luận', 'success');
                                await loadComments(targetPostId);
                                await loadPosts();
                            }
                        } catch (deleteError) {
                            showToast(deleteError.message || 'Không thể xóa bình luận', 'error');
                        }
                    });
                });
            }
        } catch (error) {
            // ignore
        }
    }

    function renderPreviews() {
        if (!previewContainer) return;
        if (!files.length) {
            previewContainer.innerHTML = '';
            return;
        }

        previewContainer.innerHTML = files.map((file, idx) => {
            const url = URL.createObjectURL(file);
            return `
                <div class="upload-preview-item" data-index="${idx}">
                    <img src="${url}" class="upload-preview-img" alt="preview">
                    <button type="button" class="upload-remove" data-index="${idx}" aria-label="Xóa">×</button>
                    <div class="upload-progress">
                        <div class="upload-progress-bar"></div>
                    </div>
                    <div class="upload-progress-text">0%</div>
                </div>
            `;
        }).join('');

        previewContainer.querySelectorAll('.upload-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index, 10);
                files.splice(index, 1);
                mediaInput.value = '';
                setFileLabel(mediaInput, mediaLabel);
                renderPreviews();
            });
        });
    }
};
