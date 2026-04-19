// ============================================
// FEED PAGE
// File: frontend/js/pages/feed.js
// ============================================

window.pageInit = async function() {
    const list = document.getElementById('feed-list');
    const profileLink = document.getElementById('feed-profile-link');
    const currentUser = Auth.getCurrentUser();
    const isAdmin = currentUser?.role === 'admin';

    if (profileLink && Auth.isAuthenticated()) {
        const me = Auth.getCurrentUser();
        profileLink.setAttribute('href', `/trangcanhan/${me.id}`);
    }

    await loadPosts();

    async function loadPosts() {
        try {
            const response = await api.get('/posts');
            if (response.success) {
                renderPosts(response.data.posts || []);
            }
        } catch (error) {
            list.innerHTML = '<p>Không thể tải feed.</p>';
        }
    }

    function renderPosts(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có bài đăng nào.</p>';
            return;
        }

        list.innerHTML = items.map(post => `
            <article class="post-card post-facebook" data-post-id="${post.id}">
                <div class="post-header">
                    <a href="${getProfileHref(post.user_id)}" class="post-user post-author-link" data-profile-link="${post.user_id}">
                        ${renderAvatarWithFrame({ avatar: post.avatar, gender: post.gender, frame_url: post.frame_url }, 'md', post.full_name)}
                        <div>
                            <div class="post-user-name">${renderDisplayName(post, post.full_name)}</div>
                            <div class="post-meta">${formatDate(post.created_at)}</div>
                        </div>
                    </a>
                    <button class="btn-ghost post-more"><i class="fas fa-ellipsis-h"></i></button>
                </div>
                <div class="post-content">${post.content}</div>
                ${renderMedia(post.media || [])}
                ${post.is_archived ? '<div class="badge badge-info">Bài viết đã lưu trữ</div>' : ''}
                <div class="post-stats">
                    <span><i class="fas fa-thumbs-up"></i> ${post.like_count || 0}</span>
                    <span>${post.comment_count || 0} bình luận</span>
                </div>
                <div class="post-actions">
                    <button class="btn-ghost btn-like ${post.is_liked ? 'active' : ''}" data-like="${post.id}" ${post.is_archived ? 'disabled' : ''}>
                        <i class="fas fa-thumbs-up"></i> Thích
                    </button>
                    <button class="btn-ghost" data-toggle-comments="${post.id}" ${post.is_archived ? 'disabled' : ''}>
                        <i class="fas fa-comment"></i> Bình luận
                    </button>
                </div>
                <div class="post-comments" id="comments-${post.id}" style="display:none;">
                    <div class="comment-list"></div>
                    <form class="comment-form" data-comment-form="${post.id}">
                        <input type="text" name="content" placeholder="Viết bình luận..." required>
                        <button type="submit" class="btn-primary">Gửi</button>
                    </form>
                </div>
            </article>
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
                            <video controls src="${m.media_url}" data-media="video"></video>
                        ` : `
                            <img src="${m.media_url}" alt="media" data-media="image">
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

        // Media click to open viewer
        list.querySelectorAll('[data-media]').forEach(el => {
            el.addEventListener('click', () => {
                const type = el.getAttribute('data-media');
                const src = el.getAttribute('src');
                openMediaViewer(type, src);
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

    function openMediaViewer(type, src) {
        let modal = document.getElementById('media-viewer');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'media-viewer';
            modal.className = 'media-viewer';
            modal.innerHTML = `
                <div class="media-viewer-backdrop"></div>
                <div class="media-viewer-content"></div>
                <button class="media-viewer-close">&times;</button>
            `;
            document.body.appendChild(modal);

            modal.querySelector('.media-viewer-backdrop').addEventListener('click', closeMediaViewer);
            modal.querySelector('.media-viewer-close').addEventListener('click', closeMediaViewer);
        }

        const content = modal.querySelector('.media-viewer-content');
        if (type === 'video') {
            content.innerHTML = `<video controls autoplay src="${src}"></video>`;
        } else {
            content.innerHTML = `<img src="${src}" alt="media">`;
        }

        modal.classList.add('active');
    }

    function closeMediaViewer() {
        const modal = document.getElementById('media-viewer');
        if (!modal) return;
        modal.classList.remove('active');
        const content = modal.querySelector('.media-viewer-content');
        if (content) content.innerHTML = '';
    }
};
