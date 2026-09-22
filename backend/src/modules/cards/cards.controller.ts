import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CardsService } from './cards.service';
import {
  AdminApproveCardDto,
  AdminRejectCardDto,
  BlockCardDto,
  IssueCardDto,
  RevealCardDto,
  SimulateCardTransactionDto,
  UpdateCardLimitsDto,
} from './dto/cards.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CardBrand, CardStatus, CardType } from '@prisma/client';

@Controller('cards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  /**
   * Issue new virtual/physical card
   */
  @Post('issue')
  async issueCard(
    @CurrentUser('id') userId: string,
    @Body() dto: IssueCardDto,
  ) {
    return this.cardsService.issueCard(userId, dto);
  }

  /**
   * List customer's cards
   */
  @Get()
  async getUserCards(@CurrentUser('id') userId: string) {
    return this.cardsService.getUserCards(userId);
  }

  /**
   * Admin: List all cards across bank
   */
  @Get('admin/all')
  @RequirePermissions('cards.read')
  async adminListCards(
    @Query('status') status?: CardStatus,
    @Query('cardType') cardType?: CardType,
    @Query('brand') brand?: CardBrand,
  ) {
    return this.cardsService.adminListCards({ status, cardType, brand });
  }

  /**
   * Admin: Approve pending card application
   */
  @Post('admin/:id/approve')
  @RequirePermissions('cards.update')
  async adminApproveCard(
    @Param('id') cardId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminApproveCardDto,
  ) {
    return this.cardsService.adminApproveCard(cardId, adminId, dto.notes);
  }

  /**
   * Admin: Reject pending card application
   */
  @Post('admin/:id/reject')
  @RequirePermissions('cards.update')
  async adminRejectCard(
    @Param('id') cardId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminRejectCardDto,
  ) {
    return this.cardsService.adminRejectCard(cardId, adminId, dto.reason);
  }

  /**
   * Get single card info with recent transactions
   */
  @Get(':id')
  async getCardById(
    @CurrentUser('id') userId: string,
    @Param('id') cardId: string,
  ) {
    return this.cardsService.getCardById(userId, cardId);
  }

  /**
   * Securely reveal full PAN and CVV
   */
  @Post(':id/reveal')
  async revealCardDetails(
    @CurrentUser('id') userId: string,
    @Param('id') cardId: string,
    @Body() dto: RevealCardDto,
  ) {
    return this.cardsService.revealCardDetails(userId, cardId, dto);
  }

  /**
   * Toggle card frozen state
   */
  @Post(':id/freeze')
  async toggleCardFreeze(
    @CurrentUser('id') userId: string,
    @Param('id') cardId: string,
  ) {
    return this.cardsService.toggleCardFreeze(userId, cardId);
  }

  /**
   * Block card permanently
   */
  @Post(':id/block')
  async blockCard(
    @CurrentUser('id') userId: string,
    @Param('id') cardId: string,
    @Body() dto: BlockCardDto,
  ) {
    return this.cardsService.blockCard(userId, cardId, dto);
  }

  /**
   * Update spending limits
   */
  @Patch(':id/limits')
  async updateCardLimits(
    @CurrentUser('id') userId: string,
    @Param('id') cardId: string,
    @Body() dto: UpdateCardLimitsDto,
  ) {
    return this.cardsService.updateCardLimits(userId, cardId, dto);
  }

  /**
   * Simulate POS/Online card purchase
   */
  @Post(':id/simulate-pos')
  async simulateCardTransaction(
    @Param('id') cardId: string,
    @Body() dto: SimulateCardTransactionDto,
  ) {
    return this.cardsService.simulateCardTransaction(cardId, dto);
  }
}
