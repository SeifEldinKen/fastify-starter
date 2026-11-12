import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import ForgotPasswordUseCase from '../../../domain/use-cases/auth/forgot-password.usecase.js'
import GetCurrentUserUseCase from '../../../domain/use-cases/auth/get-current-user.usecase.js'
import LoginUseCase from '../../../domain/use-cases/auth/login.usecase.js'
import LogoutUseCase from '../../../domain/use-cases/auth/logout.usecase.js'
import RegisterUseCase from '../../../domain/use-cases/auth/register.usecase.js'
import ResetPasswordUseCase from '../../../domain/use-cases/auth/reset-password.usecase.js'
import VerifyResetOtpUseCase from '../../../domain/use-cases/auth/verify-reset-otp.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import RateLimitHook from '../../hooks/rate-limit.hook.js'
import BaseController from '../base.controller.js'
import {
  currentUserSchema,
  type ForgotPasswordBody,
  forgotPasswordSchema,
  type LoginBody,
  loginSchema,
  logoutSchema,
  type RegisterBody,
  type ResetPasswordBody,
  registerSchema,
  resetPasswordSchema,
  type VerifyResetOtpBody,
  verifyResetOtpSchema,
} from './auth.schemas.js'

export default class AuthController extends BaseController {
  protected readonly prefix = '/auth'

  constructor(
    private readonly registerUseCase: RegisterUseCase = new RegisterUseCase(),
    private readonly loginUseCase: LoginUseCase = new LoginUseCase(),
    private readonly logoutUseCase: LogoutUseCase = new LogoutUseCase(),
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase = new GetCurrentUserUseCase(),
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase = new ForgotPasswordUseCase(),
    private readonly verifyResetOtpUseCase: VerifyResetOtpUseCase = new VerifyResetOtpUseCase(),
    private readonly resetPasswordUseCase: ResetPasswordUseCase = new ResetPasswordUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    const rateLimit = new RateLimitHook()

    /* GET */
    app.get('/me', {
      schema: currentUserSchema,
      handler: this.getCurrentUser.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
      ],
    })

    /* POST */
    app.post<{ Body: RegisterBody }>('/register', {
      schema: registerSchema,
      handler: this.register.bind(this),
      onRequest: [
        /* Middlewares */
      ],
    })

    app.post<{ Body: LoginBody }>('/login', {
      schema: loginSchema,
      handler: this.login.bind(this),
      onRequest: [
        /* Middlewares */
      ],
    })

    app.post<{ Body: ForgotPasswordBody }>('/forgot-password', {
      schema: forgotPasswordSchema,
      handler: this.forgotPassword.bind(this),
      onRequest: [
        /* Middlewares */
        rateLimit.byIp({
          name: 'forgot-password',
          max: 10,
          windowSeconds: 3600,
        }),
      ],
      preHandler: [
        /* Middlewares */
        rateLimit.byEmail({
          name: 'forgot-password-minute',
          max: 1,
          windowSeconds: 60,
        }),
        rateLimit.byEmail({
          name: 'forgot-password-hour',
          max: 3,
          windowSeconds: 3600,
        }),
      ],
    })

    app.post<{ Body: VerifyResetOtpBody }>('/verify-reset-otp', {
      schema: verifyResetOtpSchema,
      handler: this.verifyResetOtp.bind(this),
      onRequest: [
        /* Middlewares */
        rateLimit.byIp({
          name: 'verify-reset-otp',
          max: 20,
          windowSeconds: 600,
        }),
      ],
      preHandler: [
        /* Middlewares */
        rateLimit.byEmail({
          name: 'verify-reset-otp',
          max: 10,
          windowSeconds: 600,
        }),
      ],
    })

    app.post<{ Body: ResetPasswordBody }>('/reset-password', {
      schema: resetPasswordSchema,
      handler: this.resetPassword.bind(this),
      onRequest: [
        /* Middlewares */
        rateLimit.byIp({
          name: 'reset-password',
          max: 10,
          windowSeconds: 3600,
        }),
      ],
    })

    app.post('/logout', {
      schema: logoutSchema,
      handler: this.logout.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
      ],
    })
  }

  private async register(
    request: FastifyRequest<{
      Body: RegisterBody
    }>,
    reply: FastifyReply,
  ) {
    const { email, password, firstName, lastName } = request.body

    // --> call use case to create the user
    const user = await this.registerUseCase.execute({
      email,
      password,
      firstName,
      lastName,
    })

    return this.created(reply, user)
  }

  private async login(
    request: FastifyRequest<{
      Body: LoginBody
    }>,
    reply: FastifyReply,
  ) {
    const userAgent = request.headers['user-agent']

    const result = await this.loginUseCase.execute({
      ...request.body,
      ipAddress: request.ip,
      ...(userAgent && { userAgent }),
    })

    return this.ok(reply, result)
  }

  private async forgotPassword(
    request: FastifyRequest<{
      Body: ForgotPasswordBody
    }>,
    reply: FastifyReply,
  ) {
    await this.forgotPasswordUseCase.execute(request.body)

    // --> same answer whether the email is registered or not
    return this.ok(reply, {
      message: 'If an account is linked to this email, you will receive password reset instructions',
    })
  }

  private async verifyResetOtp(
    request: FastifyRequest<{
      Body: VerifyResetOtpBody
    }>,
    reply: FastifyReply,
  ) {
    const result = await this.verifyResetOtpUseCase.execute(request.body)

    return this.ok(reply, result)
  }

  private async resetPassword(
    request: FastifyRequest<{
      Body: ResetPasswordBody
    }>,
    reply: FastifyReply,
  ) {
    await this.resetPasswordUseCase.execute(request.body)

    return this.noContent(reply)
  }

  private async getCurrentUser(request: FastifyRequest, reply: FastifyReply) {
    const { userId } = request.user

    // --> call use case to get the user
    const user = await this.getCurrentUserUseCase.execute({
      userId,
    })

    return this.ok(reply, user)
  }

  private async logout(request: FastifyRequest, reply: FastifyReply) {
    await this.logoutUseCase.execute({ sessionId: request.user.sessionId })

    return this.noContent(reply)
  }
}
